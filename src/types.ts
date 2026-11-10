// promptplan 이 주고받는 데이터 모양.
// Langfuse 공개 API v2 의 프롬프트 타입(@langfuse/core 6.1.1 기준)을 필요한 만큼만 옮겼다.

export type PromptType = "text" | "chat";

/** chat 프롬프트의 한 줄. 일반 메시지 또는 실행 때 메시지 배열을 끼우는 플레이스홀더. */
export type ChatMessage =
  | { type: "chatmessage"; role: string; content: string }
  | { type: "placeholder"; name: string };

/** 파일 하나에서 읽은 "원하는 모습". */
export interface PromptSpec {
  /** Langfuse 프롬프트 이름 (예: support/greeting) */
  name: string;
  /** --dir 기준 상대 posix 경로 (예: support/greeting.md) */
  file: string;
  type: PromptType;
  /** 정규화된 본문: text 는 문자열, chat 은 메시지 배열 */
  prompt: string | ChatMessage[];
  /** 파일에 config 가 없으면 undefined (서버 기본값 {} 와 같은 것으로 본다) */
  config: Record<string, unknown> | undefined;
  /** 이 프롬프트에 붙어야 하는 라벨(정렬·중복 제거) */
  labels: string[];
  /** 파일에 tags 가 없으면 undefined — 원격 tags 를 건드리지 않는다 */
  tags: string[] | undefined;
  /** 프론트매터의 commitMessage (선택) */
  commitMessage: string | undefined;
}

/** GET /api/public/v2/prompts/{name} 응답(필요한 필드만). */
export interface RemotePrompt {
  name: string;
  version: number;
  type: PromptType;
  prompt: unknown;
  config?: unknown;
  labels: string[];
  tags: string[];
  commitMessage?: string | null;
}

/** GET /api/public/v2/prompts 목록의 한 항목. */
export interface RemotePromptMeta {
  name: string;
  type: PromptType;
  versions: number[];
  labels: string[];
  tags: string[];
}

/** POST /api/public/v2/prompts 요청 본문. */
export interface CreatePromptBody {
  name: string;
  type: PromptType;
  prompt: string | ChatMessage[];
  config?: Record<string, unknown>;
  labels: string[];
  tags?: string[];
  commitMessage?: string;
}

/** 파일이나 원격 상태가 Langfuse 규칙을 어길 때의 오류 한 건. */
export interface PlanError {
  /** 관련 프롬프트 이름(모르면 파일 경로) */
  name: string;
  file: string;
  message: string;
}

export type WarningKind =
  | "drift"
  | "variable-removed"
  | "variable-added"
  | "placeholder-removed"
  | "placeholder-added"
  | "tags";

export interface PlanWarning {
  kind: WarningKind;
  message: string;
}

export type ChangeAction = "create" | "new-version" | "move" | "unchanged";

/** 라벨 하나가 어느 버전에서 어느 버전으로 가는지. from 이 null 이면 새로 붙는 라벨. */
export interface LabelMove {
  label: string;
  from: number | null;
  to: number;
}

/** 프롬프트 하나에 대한 계획. */
export interface PromptChange {
  name: string;
  file: string;
  type: PromptType;
  action: ChangeAction;
  /** apply 뒤 원하는 라벨이 가리킬 버전(새 버전이면 예상 번호) */
  targetVersion: number;
  /** 원격의 최신 버전(없으면 null) */
  latestVersion: number | null;
  /** diff·변수 비교의 기준이 된 원격 버전(없으면 null) */
  baselineVersion: number | null;
  labels: string[];
  labelMoves: LabelMove[];
  /** 기준 버전 대비 줄 단위 unified diff (변화 없으면 빈 배열) */
  diff: string[];
  warnings: PlanWarning[];
  /** apply 가 보낼 요청 (unchanged 면 null). commitMessage 는 apply 때 붙는다 */
  request:
    | { kind: "create"; body: CreatePromptBody; commitMessage: string | undefined }
    | { kind: "patch"; version: number; newLabels: string[] }
    | null;
}

export interface PlanSummary {
  create: number;
  newVersion: number;
  move: number;
  unchanged: number;
}

export interface Plan {
  /** 사람이 읽는 대상 설명(포트·경로 없음). 예: "practice mock (--mock-state)" */
  target: string;
  /** --label 로 라벨을 덮어썼으면 그 라벨들 */
  labelOverride: string[] | null;
  changes: PromptChange[];
  /** 원격에는 있지만 파일이 없는 프롬프트(관리 밖, 건드리지 않음) */
  unmanaged: string[];
  errors: PlanError[];
  summary: PlanSummary;
}
