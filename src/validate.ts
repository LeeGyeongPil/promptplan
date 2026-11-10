// Langfuse 가 서버에서 400 으로 거부할 값을 원격에 보내기 전에 막는다.
// 규칙 출처(2026-11-10 확인): langfuse/langfuse packages/shared/src/features/prompts/constants.ts·validation.ts

import type { PlanError, PromptSpec, RemotePromptMeta } from "./types.js";

export const LABEL_PATTERN = /^[a-z0-9_\-.]+$/;
export const MAX_LABEL_LENGTH = 36;
export const MAX_NAME_LENGTH = 255;
export const MAX_COMMIT_MESSAGE_LENGTH = 500;
export const RESERVED_NAMES = ["new", "metrics", "prompt-detail"];
/** apply 가 만든 버전의 commitMessage 앞머리 — 드리프트 판정에 쓴다 */
export const COMMIT_PREFIX = "[promptplan] ";

/** 라벨 하나의 문제를 설명하는 문장. 문제가 없으면 null. */
export function labelProblem(label: string): string | null {
  if (label === "latest") return `label "latest" is reserved — Langfuse moves it to the newest version automatically`;
  if (label.length > MAX_LABEL_LENGTH) return `label "${label}" is longer than ${MAX_LABEL_LENGTH} characters`;
  if (!LABEL_PATTERN.test(label))
    return `label "${label}" is invalid — use lowercase letters, digits, "_", "-" or "." only`;
  return null;
}

/** 프롬프트 이름의 문제. 문제가 없으면 null. */
export function nameProblem(name: string): string | null {
  if (name.trim() === "") return "prompt name is empty";
  if (name.length > MAX_NAME_LENGTH) return `prompt name is longer than ${MAX_NAME_LENGTH} characters`;
  if (name.includes("|")) return `prompt name "${name}" contains "|", which Langfuse does not allow`;
  if (RESERVED_NAMES.includes(name))
    return `prompt name "${name}" is reserved by Langfuse (${RESERVED_NAMES.join(", ")}) — rename the file or set name: in front matter`;
  return null;
}

export function commitMessageProblem(message: string): string | null {
  return message.length > MAX_COMMIT_MESSAGE_LENGTH
    ? `commit message is ${message.length} characters; Langfuse allows ${MAX_COMMIT_MESSAGE_LENGTH}`
    : null;
}

/** 파일만 보고 알 수 있는 규칙 위반(원격 조회 전). */
export function validateSpecs(specs: PromptSpec[], labelOverride: string[] | null): PlanError[] {
  const errors: PlanError[] = [];
  const seen = new Map<string, string>();
  for (const spec of specs) {
    const add = (message: string) => errors.push({ name: spec.name, file: spec.file, message });
    const nameIssue = nameProblem(spec.name);
    if (nameIssue) add(nameIssue);
    const firstFile = seen.get(spec.name);
    if (firstFile) add(`prompt name "${spec.name}" is also defined in ${firstFile}`);
    else seen.set(spec.name, spec.file);
    // --label 로 덮어쓰면 파일의 labels 는 쓰이지 않으므로 검사하지 않는다(덮어쓴 라벨은 CLI 에서 검사).
    if (!labelOverride) {
      for (const label of spec.labels) {
        const issue = labelProblem(label);
        if (issue) add(issue);
      }
    }
    if (spec.commitMessage !== undefined) {
      const issue = commitMessageProblem(COMMIT_PREFIX + spec.commitMessage);
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
      message: `type change ${meta.type} → ${spec.type} is not allowed — Langfuse keeps the first type; use a new prompt name`,
    },
  ];
}
