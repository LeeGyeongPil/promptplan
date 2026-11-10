// 테스트 공용 도구. 모든 테스트는 네트워크 없이 127.0.0.1 임의 포트의 연습용 목에 실제 HTTP 로 붙는다.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type PromptApi } from "../src/client.js";
import { loadPromptDir } from "../src/files.js";
import { readMockState, startMockServer, type MockServer, type MockState, type RecordedRequest } from "../src/mock/server.js";
import { createPlan } from "../src/planner.js";
import type { Plan } from "../src/types.js";

/** 레포 루트 (dist/test/ 에서 두 단계 위) */
export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const EXAMPLES = path.join(ROOT, "examples");
export const PROMPTS_DIR = path.join(EXAMPLES, "prompts");
export const BROKEN_DIR = path.join(EXAMPLES, "broken");
export const SEED_FILE = path.join(EXAMPLES, "remote-seed.json");
export const CLI = path.join(ROOT, "dist", "src", "cli.js");

export function loadSeed(): Promise<MockState> {
  return readMockState(SEED_FILE);
}

export interface Harness {
  mock: MockServer;
  api: PromptApi;
}

/** 목을 띄우고 fn 을 돌린 뒤 반드시 닫는다. */
export async function withMock<T>(seed: MockState | undefined, fn: (h: Harness) => Promise<T>): Promise<T> {
  const mock = await startMockServer({ seed });
  try {
    // 재시도 대기는 테스트에서 0 으로
    const api = createClient({ baseUrl: mock.url, publicKey: "pk-lf-test", secretKey: "sk-lf-test", sleep: async () => {} });
    return await fn({ mock, api });
  } finally {
    await mock.close();
  }
}

export async function planDir(dir: string, api: PromptApi, labelOverride: string[] | null = null): Promise<Plan> {
  const { specs, errors } = await loadPromptDir(dir);
  return createPlan(specs, errors, api, { target: "practice mock (test)", labelOverride });
}

/** 원격을 바꾸는 요청(POST·PATCH·DELETE)만 */
export function writes(requests: RecordedRequest[]): RecordedRequest[] {
  return requests.filter((r) => r.method !== "GET");
}

export function versionCounts(state: MockState): Record<string, number> {
  return Object.fromEntries(state.prompts.map((p) => [p.name, p.versions.length]));
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "promptplan-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
