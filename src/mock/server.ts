// 연습용 목(mock) — 메모리에서만 도는 가짜 Langfuse 프롬프트 API(v2).
//
// 실제 Langfuse 서버가 아니다. langfuse 본 레포 소스(2026-11-10 확인)와 공식 JS SDK 6.1.1 요청 캡처를 보고
// promptplan 이 기대는 규칙만 다시 구현했다:
//   - POST 는 내용이 같아도 언제나 새 버전을 만든다(그래서 비교 없이 올리면 버전이 쌓인다)
//   - "latest" 라벨은 서버가 가장 새 버전에 자동으로 붙이고, 직접 붙이면 400
//   - 라벨은 한 프롬프트 안에서 한 버전에만 붙는다(다른 버전에 붙이면 기존 버전에서 떨어진다)
//   - PATCH newLabels 는 "추가(union)" — 대상 버전의 기존 라벨은 그대로 남는다
//   - 처음 정한 타입(text/chat)과 다르면 400, 라벨 형식이 틀리면 400, 없으면 404, 인증 없으면 401
// 시계는 고정(2026-01-01T00:00:00Z 부터 요청마다 1초)이라 결과가 실행 시각에 따라 달라지지 않는다.

import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { PromptType } from "../types.js";
import { labelProblem, nameProblem, MAX_COMMIT_MESSAGE_LENGTH } from "../validate.js";
import { byCodepoint, isPlainObject } from "../util.js";

/** 상태 파일(--mock-state)·시드 파일의 버전 한 개. version 은 1부터 순서대로. */
export interface MockVersionState {
  version: number;
  prompt: unknown;
  config?: unknown;
  /** "latest" 는 적지 않는다(서버가 자동으로 붙인다) */
  labels?: string[];
  commitMessage?: string | null;
}

export interface MockPromptState {
  name: string;
  type: PromptType;
  tags?: string[];
  versions: MockVersionState[];
}

export interface MockState {
  prompts: MockPromptState[];
}

/** 목이 받은 요청 한 건(테스트·데모가 "무슨 요청이 나갔나"를 확인하는 데 쓴다). */
export interface RecordedRequest {
  method: string;
  /** 인코딩된 그대로의 경로 (예: /api/public/v2/prompts/qa%2Fanswer/versions/2) */
  path: string;
  query: Record<string, string>;
  body: unknown;
  status: number;
}

export interface MockServer {
  /** http://127.0.0.1:<port> — 화면에 찍지 않는다(포트는 실행마다 다르다) */
  url: string;
  requests: RecordedRequest[];
  /** 지금 상태를 파일에 쓸 수 있는 모양으로 돌려준다 */
  snapshot(): MockState;
  /** 다음 요청 하나를 지정한 상태 코드로 실패시킨다(재시도 시험용) */
  failNext(status: number, headers?: Record<string, string>): void;
  close(): Promise<void>;
}

export interface MockOptions {
  seed?: MockState;
  host?: string;
  /** 0 이면 운영체제가 빈 포트를 고른다 */
  port?: number;
}

interface StoredVersion {
  id: string;
  name: string;
  version: number;
  type: PromptType;
  prompt: unknown;
  config: unknown;
  labels: string[];
  tags: string[];
  commitMessage: string | null;
  createdAt: string;
  updatedAt: string;
  resolutionGraph: null;
}

const PREFIX = "/api/public/v2/prompts";
const MAX_BODY_BYTES = 1_000_000;
const MAX_RECORDED = 10_000; // 요청 기록 상한(오래 띄워 둬도 메모리가 계속 늘지 않게)
const EPOCH = Date.UTC(2026, 0, 1);

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body["message"] ?? status));
  }
}

const notFound = () => new HttpError(404, { error: "LangfusePromptNotFoundError", message: "Prompt not found" });
const badRequest = (message: string) => new HttpError(400, { error: "InvalidRequestError", message });

export async function startMockServer(options: MockOptions = {}): Promise<MockServer> {
  const store = new Map<string, StoredVersion[]>();
  const requests: RecordedRequest[] = [];
  const failures: Array<{ status: number; headers: Record<string, string> }> = [];
  let tick = 0;
  const now = () => new Date(EPOCH + tick++ * 1000).toISOString();

  // ---- 상태 다루기 -------------------------------------------------------

  /** "latest" 는 언제나 가장 큰 버전 하나에만. */
  function refreshLatest(versions: StoredVersion[]): void {
    const newest = Math.max(...versions.map((v) => v.version));
    for (const v of versions) {
      v.labels = v.labels.filter((l) => l !== "latest");
      if (v.version === newest) v.labels.unshift("latest");
    }
  }

  /** 라벨을 target 버전으로 옮긴다: 같은 프롬프트의 다른 버전에서는 떼고, target 에는 더한다(union). */
  function moveLabels(versions: StoredVersion[], target: StoredVersion, labels: string[]): void {
    for (const label of labels) {
      for (const v of versions) if (v !== target) v.labels = v.labels.filter((l) => l !== label);
      if (!target.labels.includes(label)) target.labels.push(label);
    }
  }

  function addVersion(input: {
    name: string;
    type: PromptType;
    prompt: unknown;
    config: unknown;
    labels: string[];
    tags: string[] | undefined;
    commitMessage: string | null;
  }): StoredVersion {
    const versions = store.get(input.name) ?? [];
    const time = now();
    const created: StoredVersion = {
      id: `mock-${input.name}-${versions.length + 1}`,
      name: input.name,
      version: versions.length + 1,
      type: input.type,
      prompt: input.prompt,
      config: input.config ?? {},
      labels: [],
      tags: input.tags ?? versions[0]?.tags ?? [],
      commitMessage: input.commitMessage,
      createdAt: time,
      updatedAt: time,
      resolutionGraph: null,
    };
    versions.push(created);
    store.set(input.name, versions);
    // tags 는 프롬프트의 모든 버전에 공통 — 새 버전에서 주면 전체가 바뀐다.
    if (input.tags) for (const v of versions) v.tags = [...input.tags];
    moveLabels(versions, created, input.labels);
    refreshLatest(versions);
    return created;
  }

  for (const prompt of options.seed?.prompts ?? []) {
    const ordered = [...prompt.versions].sort((a, b) => a.version - b.version);
    ordered.forEach((v, index) => {
      if (v.version !== index + 1) throw new Error(`mock seed: ${prompt.name} versions must be 1, 2, 3, … (found ${v.version})`);
      addVersion({
        name: prompt.name,
        type: prompt.type,
        prompt: v.prompt,
        config: v.config,
        labels: (v.labels ?? []).filter((l) => l !== "latest"),
        tags: prompt.tags,
        commitMessage: v.commitMessage ?? null,
      });
    });
  }

  function snapshot(): MockState {
    const names = [...store.keys()].sort(byCodepoint);
    return {
      prompts: names.map((name) => {
        const versions = store.get(name) as StoredVersion[];
        const first = versions[0] as StoredVersion;
        return {
          name,
          type: first.type,
          tags: [...first.tags],
          versions: versions.map((v) => ({
            version: v.version,
            prompt: v.prompt,
            config: v.config,
            labels: v.labels.filter((l) => l !== "latest").sort(byCodepoint),
            commitMessage: v.commitMessage,
          })),
        };
      }),
    };
  }

  // ---- 경로별 처리 -------------------------------------------------------

  function handle(method: string, url: URL, body: unknown): { status: number; body?: unknown } {
    const path = url.pathname;

    if (path === PREFIX && method === "POST") {
      if (!isPlainObject(body)) throw badRequest("body must be a JSON object");
      const name = body["name"];
      if (typeof name !== "string") throw badRequest("name is required");
      const nameIssue = nameProblem(name);
      if (nameIssue) throw badRequest(nameIssue);
      const type = (body["type"] ?? "text") as PromptType;
      if (type !== "text" && type !== "chat") throw badRequest(`unknown type ${String(type)}`);
      if (type === "text" && typeof body["prompt"] !== "string") throw badRequest("text prompt must be a string");
      if (type === "chat" && !Array.isArray(body["prompt"])) throw badRequest("chat prompt must be an array");
      const labels = (body["labels"] ?? []) as string[];
      for (const label of labels) {
        const issue = labelProblem(label);
        if (issue) throw badRequest(issue);
      }
      const commitMessage = body["commitMessage"];
      if (typeof commitMessage === "string" && commitMessage.length > MAX_COMMIT_MESSAGE_LENGTH)
        throw badRequest("commitMessage is too long");
      const existing = store.get(name);
      if (existing && existing[0]?.type !== type)
        throw badRequest(`Previous versions have different prompt type. Create a new prompt with a different name.`);
      // SDK 처럼 chat 메시지에 type 을 붙여 저장한다(원격 응답에 "chatmessage" 가 들어 있는 이유).
      const prompt =
        type === "chat"
          ? (body["prompt"] as unknown[]).map((m) =>
              isPlainObject(m) && m["type"] === undefined && typeof m["role"] === "string" ? { ...m, type: "chatmessage" } : m,
            )
          : body["prompt"];
      const created = addVersion({
        name,
        type,
        prompt,
        config: body["config"] ?? {},
        labels,
        tags: Array.isArray(body["tags"]) ? (body["tags"] as string[]) : undefined,
        commitMessage: typeof commitMessage === "string" ? commitMessage : null,
      });
      return { status: 201, body: created };
    }

    if (path === PREFIX && method === "GET") {
      const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
      const all = [...store.keys()].sort(byCodepoint).map((name) => {
        const versions = store.get(name) as StoredVersion[];
        const last = versions.at(-1) as StoredVersion;
        return {
          name,
          type: last.type,
          versions: versions.map((v) => v.version),
          labels: [...new Set(versions.flatMap((v) => v.labels))],
          tags: last.tags,
          lastUpdatedAt: last.updatedAt,
          lastConfig: last.config,
        };
      });
      return {
        status: 200,
        body: {
          data: all.slice((page - 1) * limit, page * limit),
          meta: { page, limit, totalItems: all.length, totalPages: Math.ceil(all.length / limit) },
        },
      };
    }

    let match = path.match(/^\/api\/public\/v2\/prompts\/([^/]+)\/versions\/(\d+)$/);
    if (match && method === "PATCH") {
      const versions = store.get(decodeURIComponent(match[1] as string));
      const target = versions?.find((v) => v.version === Number(match?.[2]));
      if (!versions || !target) throw notFound();
      const newLabels = isPlainObject(body) ? body["newLabels"] : undefined;
      if (!Array.isArray(newLabels) || newLabels.some((l) => typeof l !== "string"))
        throw badRequest("newLabels must be a list of strings");
      for (const label of newLabels as string[]) {
        const issue = labelProblem(label);
        if (issue) throw badRequest(issue);
      }
      moveLabels(versions, target, newLabels as string[]);
      target.updatedAt = now();
      return { status: 200, body: target };
    }

    match = path.match(/^\/api\/public\/v2\/prompts\/([^/]+)$/);
    if (match && method === "GET") {
      // resolve=false 는 받아만 둔다 — 목은 프롬프트 합성(@@@langfusePrompt…@@@)을 펼치지 않는다.
      const versions = store.get(decodeURIComponent(match[1] as string));
      const version = url.searchParams.get("version");
      const label = url.searchParams.get("label");
      if (version !== null && label !== null) throw badRequest("Cannot specify both version and label");
      const wanted = label ?? (version === null ? "production" : null);
      const found = versions?.find((v) => (wanted === null ? v.version === Number(version) : v.labels.includes(wanted)));
      if (!found) throw notFound();
      return { status: 200, body: found };
    }

    return { status: 404, body: { message: "no such route in the promptplan practice mock" } };
  }

  // ---- HTTP 서버 ---------------------------------------------------------

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      else chunks.push(chunk);
    });
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://mock.invalid");
      const method = req.method ?? "GET";
      const send = (status: number, payload?: unknown, headers: Record<string, string> = {}) => {
        const text = payload === undefined ? "" : JSON.stringify(payload);
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(text);
        return status;
      };
      let body: unknown;
      let status: number;
      try {
        if (tooLarge) throw new HttpError(413, { message: "request body too large" });
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          body = raw ? JSON.parse(raw) : undefined;
        } catch {
          throw badRequest("body is not valid JSON");
        }
        const failure = failures.shift();
        if (failure) {
          status = send(failure.status, { message: `injected failure ${failure.status}` }, failure.headers);
        } else if (!req.headers.authorization?.startsWith("Basic ")) {
          status = send(401, { message: "Unauthorized" });
        } else {
          const result = handle(method, url, body);
          status = send(result.status, result.body);
        }
      } catch (error) {
        if (error instanceof HttpError) status = send(error.status, error.body);
        else status = send(500, { message: "mock internal error" });
      }
      requests.push({ method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, status });
      if (requests.length > MAX_RECORDED) requests.splice(0, requests.length - MAX_RECORDED);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;

  return {
    url: `http://${options.host ?? "127.0.0.1"}:${address.port}`,
    requests,
    snapshot,
    failNext(status, headers = {}) {
      failures.push({ status, headers });
    },
    close() {
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
        // fetch 가 keep-alive 로 잡고 있는 연결까지 끊어야 close 콜백이 바로 온다.
        server.closeAllConnections();
      });
    },
  };
}

/** 상태 파일을 읽고 모양을 확인한다. 틀리면 사람이 읽을 수 있는 메시지로 throw. */
export async function readMockState(file: string): Promise<MockState> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    throw new Error(`cannot read mock state file (${(error as NodeJS.ErrnoException).code ?? String(error)})`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("mock state file is not valid JSON");
  }
  if (!isPlainObject(value) || !Array.isArray(value["prompts"])) throw new Error('mock state file needs { "prompts": [...] }');
  for (const prompt of value["prompts"] as unknown[]) {
    if (!isPlainObject(prompt) || typeof prompt["name"] !== "string" || !Array.isArray(prompt["versions"]))
      throw new Error("each mock prompt needs name and versions");
    if (prompt["type"] !== "text" && prompt["type"] !== "chat") throw new Error(`mock prompt ${prompt["name"]}: type must be text or chat`);
  }
  return value as unknown as MockState;
}

export async function writeMockState(file: string, state: MockState): Promise<void> {
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
