// 어디에 연결할지 정한다: 실제 Langfuse(키 필요) 또는 연습용 목(--mock-state, 키 불필요).
// process.env 를 직접 읽지 않고 env 객체를 인자로 받는다 — 테스트가 CI 의 환경 변수에 흔들리지 않게.

import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

export type Env = Record<string, string | undefined>;

export const DEFAULT_BASE_URL = "https://cloud.langfuse.com";

export type Connection =
  | { kind: "real"; baseUrl: string; publicKey: string; secretKey: string; target: string }
  | { kind: "mock"; statePath: string; target: string };

export const MOCK_TARGET = "practice mock (--mock-state)";

export const MISSING_KEYS_MESSAGE = [
  "No Langfuse keys found.",
  "  Real Langfuse: set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY (and LANGFUSE_BASE_URL for US or self-hosted),",
  "                 for example in a .env file passed with --env-file .env (see .env.example).",
  "  Practice:      add --mock-state <file> to run against the built-in practice mock, e.g.",
  "                 --mock-state examples/remote-seed.json",
].join("\n");

/** --env-file 를 읽어 env 와 합친다. 이미 있는 환경 변수가 이긴다(CI 비밀값이 파일보다 우선). */
export async function loadEnvFile(file: string, env: Env): Promise<Env> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    throw new Error(`cannot read --env-file (${(error as NodeJS.ErrnoException).code ?? String(error)})`);
  }
  return { ...parseEnv(text), ...env };
}

export function resolveConnection(options: { mockState?: string | undefined; env: Env }): Connection {
  if (options.mockState) return { kind: "mock", statePath: options.mockState, target: MOCK_TARGET };
  const publicKey = options.env["LANGFUSE_PUBLIC_KEY"]?.trim();
  const secretKey = options.env["LANGFUSE_SECRET_KEY"]?.trim();
  if (!publicKey || !secretKey) throw new Error(MISSING_KEYS_MESSAGE);
  const baseUrl = (options.env["LANGFUSE_BASE_URL"]?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    throw new Error(`LANGFUSE_BASE_URL is not a valid URL`);
  }
  return { kind: "real", baseUrl, publicKey, secretKey, target: `Langfuse at ${host}` };
}
