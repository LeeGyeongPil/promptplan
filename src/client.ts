// Langfuse 공개 API v2 의 프롬프트 엔드포인트 4개를 Node 내장 fetch 로 직접 부른다.
// 공식 SDK 를 쓰지 않는 이유: SDK 의 prompt.get 은 기본 60초 캐시가 있어 비교에 쓰기 까다롭고,
// 재시도·타임아웃을 이 도구에 맞게 정하고 싶어서다(research 4-4·7-11).

import { msg, PromptplanError, type Msg } from "./i18n.js";
import type { CreatePromptBody, RemotePrompt, RemotePromptMeta } from "./types.js";
import { isPlainObject } from "./util.js";

/** planner·apply·pull 이 쓰는 원격 API. 테스트에서는 같은 모양의 다른 구현을 넣어도 된다. */
export interface PromptApi {
  listPrompts(): Promise<RemotePromptMeta[]>;
  /** 없으면 null (404) */
  getPrompt(name: string, select: { version: number } | { label: string }): Promise<RemotePrompt | null>;
  createPrompt(body: CreatePromptBody & { commitMessage?: string }): Promise<RemotePrompt>;
  updateLabels(name: string, version: number, newLabels: string[]): Promise<RemotePrompt>;
}

export interface ClientOptions {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  /** 429·5xx 재시도 횟수(기본 3) */
  retries?: number;
  /** 요청 하나의 제한 시간(기본 120초 — Langfuse Cloud 는 공유 자원이라 느릴 수 있다) */
  timeoutMs?: number;
  /** 테스트에서 기다림을 줄이려고 바꿀 수 있다 */
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
}

/** Langfuse 가 2xx 가 아닌 응답을 줬을 때. */
export class LangfuseApiError extends PromptplanError {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly detail: string,
  ) {
    super("api.error", { status, method, path, detail, hint: hintFor(status) });
    this.name = "LangfuseApiError";
  }
}

function hintFor(status: number): Msg | string {
  if (status === 401) return msg("api.hint401");
  if (status === 403) return msg("api.hint403");
  return "";
}

const PROMPTS = "/api/public/v2/prompts";
const MAX_PAGES = 1000;
const MAX_RETRY_WAIT_MS = 30_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retry-After 헤더(초 또는 HTTP 날짜)를 밀리초로. 없거나 이상하면 null. */
export function retryAfterMs(header: string | null, nowMs: number): number | null {
  if (header === null || header.trim() === "") return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - nowMs);
}

export function createClient(options: ClientOptions): PromptApi {
  const base = options.baseUrl.replace(/\/+$/, "");
  const auth = `Basic ${Buffer.from(`${options.publicKey}:${options.secretKey}`).toString("base64")}`;
  const retries = options.retries ?? 3;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const sleep = options.sleep ?? defaultSleep;

  // 폴더가 있는 이름(support/greeting)은 반드시 support%2Fgreeting 으로 — 안 하면 404 (research 7-2).
  const promptPath = (name: string) => `${PROMPTS}/${encodeURIComponent(name)}`;

  async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
    // POST 는 5xx 에서 다시 보내지 않는다: 서버가 이미 버전을 만들었을 수 있고, 다시 보내면 같은 내용의 버전이 하나 더 생긴다.
    // 429 는 "처리하지 않았다"는 뜻이라 POST 도 다시 보낸다.
    const retryable = (status: number) => status === 429 || (status >= 500 && method !== "POST");
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(base + path, {
          method,
          headers: {
            authorization: auth,
            accept: "application/json",
            "user-agent": options.userAgent ?? "promptplan",
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const cause: Msg | string = (error as Error).name === "TimeoutError" ? msg("api.timeout", { seconds: timeoutMs / 1000 }) : String((error as Error).cause ?? error);
        throw new PromptplanError("api.unreachable", { method, path, cause });
      }
      const text = await response.text();
      if (response.ok) return { status: response.status, json: text ? JSON.parse(text) : undefined };
      if (retryable(response.status) && attempt < retries) {
        const wait = retryAfterMs(response.headers.get("retry-after"), Date.now()) ?? 500 * 2 ** attempt;
        await sleep(Math.min(wait, MAX_RETRY_WAIT_MS));
        continue;
      }
      throw new LangfuseApiError(response.status, method, path, errorDetail(text));
    }
  }

  return {
    async listPrompts() {
      const out: RemotePromptMeta[] = [];
      for (let page = 1; ; page++) {
        // 잘린 목록으로 plan 하면 타입 검사·관리 밖 표시가 틀어진다 → 조용히 자르지 않고 멈춘다.
        if (page > MAX_PAGES) throw new PromptplanError("api.tooManyPages", { max: MAX_PAGES });
        const { json } = await call("GET", `${PROMPTS}?page=${page}&limit=50`);
        if (!isPlainObject(json) || !Array.isArray(json["data"])) throw new PromptplanError("api.badList");
        out.push(...(json["data"] as RemotePromptMeta[]));
        const meta = json["meta"];
        const totalPages = isPlainObject(meta) && typeof meta["totalPages"] === "number" ? meta["totalPages"] : page;
        if (page >= totalPages || json["data"].length === 0) break;
      }
      return out;
    },

    async getPrompt(name, select) {
      const query = "version" in select ? `version=${select.version}` : `label=${encodeURIComponent(select.label)}`;
      try {
        // resolve=false: 프롬프트 합성 참조를 펼치지 않은 원문을 받아야 파일과 비교할 수 있다.
        const { json } = await call("GET", `${promptPath(name)}?${query}&resolve=false`);
        return json as RemotePrompt;
      } catch (error) {
        if (error instanceof LangfuseApiError && error.status === 404) return null;
        throw error;
      }
    },

    async createPrompt(body) {
      const { json } = await call("POST", PROMPTS, body);
      return json as RemotePrompt;
    },

    async updateLabels(name, version, newLabels) {
      const { json } = await call("PATCH", `${promptPath(name)}/versions/${version}`, { newLabels });
      return json as RemotePrompt;
    },
  };
}

function errorDetail(text: string): string {
  try {
    const value: unknown = JSON.parse(text);
    if (isPlainObject(value) && typeof value["message"] === "string") return value["message"];
  } catch {
    // JSON 이 아니면 아래에서 앞부분만 쓴다
  }
  return text.slice(0, 200) || "(empty response)";
}
