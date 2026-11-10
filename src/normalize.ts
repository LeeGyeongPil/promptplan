// 비교용 정규화.
// Langfuse 는 같은 뜻의 값을 조금씩 다르게 돌려준다(chat 메시지에 type 자동 부여, config 기본값 {} 등).
// 정규화 없이 비교하면 매번 "변경"으로 보이고, 그러면 apply 가 같은 내용의 버전을 계속 쌓는다.

import type { ChatMessage, PromptType } from "./types.js";
import { isPlainObject, stableStringify } from "./util.js";

/** 본문 끝 줄바꿈 무시, CRLF → LF. (파일은 보통 줄바꿈으로 끝나지만 원격 본문은 아니다) */
export function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n+$/, "");
}

/**
 * 원격·파일의 chat 메시지 하나를 정규형으로 바꾼다.
 * - type 이 없고 role 이 있으면 "chatmessage" (SDK·서버가 자동으로 붙이는 기본값)
 * - type 이 없고 name 만 있으면 "placeholder"
 * 모양이 맞지 않으면 null.
 */
export function normalizeMessage(raw: unknown): ChatMessage | null {
  if (!isPlainObject(raw)) return null;
  const type = raw["type"];
  if (type === "placeholder" || (type === undefined && typeof raw["name"] === "string" && raw["role"] === undefined)) {
    return typeof raw["name"] === "string" ? { type: "placeholder", name: raw["name"] } : null;
  }
  if (type === undefined || type === "chatmessage") {
    if (typeof raw["role"] !== "string" || typeof raw["content"] !== "string") return null;
    return { type: "chatmessage", role: raw["role"], content: normalizeText(raw["content"]) };
  }
  return null;
}

/** 원격 본문(unknown)을 정규형으로. 모양이 맞지 않으면 null. */
export function normalizePromptBody(type: PromptType, raw: unknown): string | ChatMessage[] | null {
  if (type === "text") return typeof raw === "string" ? normalizeText(raw) : null;
  if (!Array.isArray(raw)) return null;
  const out: ChatMessage[] = [];
  for (const item of raw) {
    const message = normalizeMessage(item);
    if (!message) return null;
    out.push(message);
  }
  return out;
}

/** config: null·없음·{} 는 모두 {} 로 본다. 객체가 아니면 그대로 둔다(그래도 비교는 된다). */
export function normalizeConfig(raw: unknown): unknown {
  if (raw === null || raw === undefined) return {};
  return raw;
}

/**
 * 내용 동일성 판정에 쓰는 "지문" 문자열.
 * type + 정규화 본문 + config(키 정렬) — 라벨·tags·commitMessage 는 내용이 아니므로 뺀다.
 */
export function contentKey(type: PromptType, prompt: unknown, config: unknown): string {
  const body = normalizePromptBody(type, prompt);
  return stableStringify({ type, prompt: body ?? prompt, config: normalizeConfig(config) });
}

/** diff 에 쓸 줄 목록: text 는 본문 줄, chat 은 메시지를 [role] 머리줄 + 내용 줄로 편다. */
export function promptLines(type: PromptType, prompt: unknown): string[] {
  const body = normalizePromptBody(type, prompt);
  if (typeof body === "string") return body === "" ? [] : body.split("\n");
  if (body === null) return [stableStringify(prompt)];
  const lines: string[] = [];
  for (const message of body) {
    if (message.type === "placeholder") {
      lines.push(`[placeholder: ${message.name}]`);
    } else {
      lines.push(`[${message.role}]`);
      if (message.content !== "") lines.push(...message.content.split("\n"));
    }
  }
  return lines;
}

/** diff 에 쓸 config 줄 목록(키 정렬, 들여쓰기 2). 빈 config 는 빈 목록. */
export function configLines(config: unknown): string[] {
  const value = normalizeConfig(config);
  if (isPlainObject(value) && Object.keys(value).length === 0) return [];
  return stableStringify(value, 2).split("\n");
}
