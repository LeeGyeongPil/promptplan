// Langfuse 가 서버에서 400 으로 거부할 값을 원격에 보내기 전에 막는다.
// 규칙 출처(2026-11-10 확인): langfuse/langfuse packages/shared/src/features/prompts/constants.ts·validation.ts
// 각 규칙은 메시지 키(Msg)로 만들고, 영어 문장(*Problem)은 그 Msg 를 영어로 펼친 것이다.
// 영어 문장은 목 서버의 HTTP 400 본문에도 쓰이므로 바뀌면 안 된다.

import { fmt, msg, planText, type Msg } from "./i18n.js";
import type { PlanError, PromptSpec, RemotePromptMeta } from "./types.js";

export const LABEL_PATTERN = /^[a-z0-9_\-.]+$/;
export const MAX_LABEL_LENGTH = 36;
export const MAX_NAME_LENGTH = 255;
export const MAX_COMMIT_MESSAGE_LENGTH = 500;
export const RESERVED_NAMES = ["new", "metrics", "prompt-detail"];
/** apply 가 만든 버전의 commitMessage 앞머리 — 드리프트 판정에 쓴다 */
export const COMMIT_PREFIX = "[promptplan] ";

/** 라벨 하나의 문제(메시지 키 형태). 문제가 없으면 null. */
export function labelIssue(label: string): Msg | null {
  if (label === "latest") return msg("rule.labelLatest");
  if (label.length > MAX_LABEL_LENGTH) return msg("rule.labelLong", { label, max: MAX_LABEL_LENGTH });
  if (!LABEL_PATTERN.test(label)) return msg("rule.labelInvalid", { label });
  return null;
}

/** 프롬프트 이름의 문제(메시지 키 형태). */
export function nameIssue(name: string): Msg | null {
  if (name.trim() === "") return msg("rule.nameEmpty");
  if (name.length > MAX_NAME_LENGTH) return msg("rule.nameLong", { max: MAX_NAME_LENGTH });
  if (name.includes("|")) return msg("rule.namePipe", { name });
  if (RESERVED_NAMES.includes(name)) return msg("rule.nameReserved", { name, reserved: RESERVED_NAMES.join(", ") });
  return null;
}

export function commitMessageIssue(message: string): Msg | null {
  return message.length > MAX_COMMIT_MESSAGE_LENGTH
    ? msg("rule.commitLong", { length: message.length, max: MAX_COMMIT_MESSAGE_LENGTH })
    : null;
}

const english = (issue: Msg | null): string | null => (issue === null ? null : fmt("en", issue));

/** 라벨 하나의 문제를 설명하는 영어 문장. 문제가 없으면 null. */
export function labelProblem(label: string): string | null {
  return english(labelIssue(label));
}

/** 프롬프트 이름의 문제(영어 문장). 문제가 없으면 null. */
export function nameProblem(name: string): string | null {
  return english(nameIssue(name));
}

export function commitMessageProblem(message: string): string | null {
  return english(commitMessageIssue(message));
}

/** 파일만 보고 알 수 있는 규칙 위반(원격 조회 전). */
export function validateSpecs(specs: PromptSpec[], labelOverride: string[] | null): PlanError[] {
  const errors: PlanError[] = [];
  const seen = new Map<string, string>();
  for (const spec of specs) {
    const add = (issue: Msg) => errors.push({ name: spec.name, file: spec.file, ...planText(issue) });
    const nameProblemMsg = nameIssue(spec.name);
    if (nameProblemMsg) add(nameProblemMsg);
    const firstFile = seen.get(spec.name);
    if (firstFile) add(msg("rule.nameDuplicate", { name: spec.name, file: firstFile }));
    else seen.set(spec.name, spec.file);
    // --label 로 덮어쓰면 파일의 labels 는 쓰이지 않으므로 검사하지 않는다(덮어쓴 라벨은 CLI 에서 검사).
    if (!labelOverride) {
      for (const label of spec.labels) {
        const issue = labelIssue(label);
        if (issue) add(issue);
      }
    }
    if (spec.commitMessage !== undefined) {
      const issue = commitMessageIssue(COMMIT_PREFIX + spec.commitMessage);
      if (issue) add(issue);
    }
  }
  return errors;
}

/** 원격과 비교해야 알 수 있는 규칙 위반: 타입(text↔chat)은 처음 정한 뒤 바꿀 수 없다. */
export function validateAgainstRemote(spec: PromptSpec, meta: RemotePromptMeta | undefined): PlanError[] {
  if (!meta || meta.type === spec.type) return [];
  return [
    {
      name: spec.name,
      file: spec.file,
      ...planText(msg("rule.typeChange", { from: meta.type, to: spec.type })),
    },
  ];
}
