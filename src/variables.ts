// 템플릿 변수({{name}})와 chat 플레이스홀더를 뽑아 비교한다.
// 앱 코드는 prompt.compile({ name, topic }) 처럼 변수 이름에 기대므로,
// 변수를 지우거나 새로 요구하면 리뷰 전에 알아야 한다.

import type { PromptType, PlanWarning } from "./types.js";
import { normalizePromptBody } from "./normalize.js";
import { sortedUnique } from "./util.js";

// Langfuse SDK 의 compile 은 mustache 형식 {{ var }} 을 채운다(앞뒤 공백 허용).
const VARIABLE = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;

export interface TemplateSlots {
  variables: string[];
  placeholders: string[];
}

export function extractSlots(type: PromptType, prompt: unknown): TemplateSlots {
  const body = normalizePromptBody(type, prompt);
  const texts: string[] = [];
  const placeholders: string[] = [];
  if (typeof body === "string") texts.push(body);
  else if (body) {
    for (const message of body) {
      if (message.type === "placeholder") placeholders.push(message.name);
      else texts.push(message.content);
    }
  }
  const variables: string[] = [];
  for (const text of texts) for (const match of text.matchAll(VARIABLE)) variables.push(match[1] as string);
  return { variables: sortedUnique(variables), placeholders: sortedUnique(placeholders) };
}

/** before(원격 기준 버전) → after(파일) 에서 사라지거나 새로 생긴 변수·플레이스홀더 경고. */
export function compareSlots(before: TemplateSlots, after: TemplateSlots, baselineVersion: number): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  const where = `(compared with v${baselineVersion})`;
  for (const name of before.variables)
    if (!after.variables.includes(name))
      warnings.push({ kind: "variable-removed", message: `variable removed: ${name} ${where} — callers passing it will be ignored` });
  for (const name of after.variables)
    if (!before.variables.includes(name))
      warnings.push({ kind: "variable-added", message: `variable added: ${name} ${where} — callers must now pass it` });
  for (const name of before.placeholders)
    if (!after.placeholders.includes(name))
      warnings.push({ kind: "placeholder-removed", message: `placeholder removed: ${name} ${where}` });
  for (const name of after.placeholders)
    if (!before.placeholders.includes(name))
      warnings.push({ kind: "placeholder-added", message: `placeholder added: ${name} ${where} — callers must now fill it` });
  return warnings;
}
