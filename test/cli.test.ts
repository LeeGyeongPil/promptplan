import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { main, VERSION } from "../src/cli.js";
import { CLI, PROMPTS_DIR, ROOT, SEED_FILE, withTempDir } from "./helpers.js";

const run = promisify(execFile);

/** CLI 를 별도 프로세스로 실행. env 는 일부러 비운다(LANGFUSE_* 키·GITHUB_SHA·NO_COLOR 가 새지 않게). */
async function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      env: { PATH: process.env["PATH"] ?? "" },
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    if (typeof e.code !== "number") throw error;
    return { code: e.code, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

const SEED_ARGS = ["--dir", "examples/prompts", "--mock-state", "examples/remote-seed.json"];

test("exit codes: 0 by default, 2 with --detailed-exitcode, 1 on error", async () => {
  // 변경 있는 plan: 기본 0
  const plain = await cli(["plan", ...SEED_ARGS]);
  assert.equal(plain.code, 0, plain.stderr);
  assert.match(plain.stdout, /Plan: 1 to create, 1 new version, 1 label move, 2 unchanged/);
  assert.ok(!plain.stdout.includes("\u001b["), "no colour when stdout is not a terminal");

  // 변경 있는 plan + --detailed-exitcode: 2
  const detailed = await cli(["plan", "--detailed-exitcode", ...SEED_ARGS]);
  assert.equal(detailed.code, 2, detailed.stderr);

  // 변경 없음 + --detailed-exitcode: 0 (상태 파일 사본에 apply 한 뒤)
  await withTempDir(async (dir) => {
    const state = path.join(dir, "state.json");
    await copyFile(SEED_FILE, state);
    const applied = await cli(["apply", "--yes", "--dir", "examples/prompts", "--mock-state", state]);
    assert.equal(applied.code, 0, applied.stderr);
    assert.match(applied.stdout, /Applied: 2 created versions, 1 label move/);
    const none = await cli(["plan", "--detailed-exitcode", "--dir", "examples/prompts", "--mock-state", state]);
    assert.equal(none.code, 0, none.stderr);
    assert.match(none.stdout, /No changes/);
  });

  // 키도 --mock-state 도 없으면 1 + 안내
  const noKeys = await cli(["plan", "--dir", "examples/prompts"]);
  assert.equal(noKeys.code, 1);
  assert.match(noKeys.stderr, /No Langfuse keys found/);
  assert.match(noKeys.stderr, /LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY/);
  assert.match(noKeys.stderr, /--mock-state/);

  // 비대화형 apply 에 --yes 가 없으면 1, 상태 파일은 그대로
  const before = await readFile(SEED_FILE, "utf8");
  const noYes = await cli(["apply", ...SEED_ARGS]);
  assert.equal(noYes.code, 1);
  assert.match(noYes.stderr, /apply needs --yes/);
  assert.equal(await readFile(SEED_FILE, "utf8"), before);

  // 잘못된 옵션·명령도 1
  assert.equal((await cli(["plan", "--nope"])).code, 1);
  assert.equal((await cli(["deploy"])).code, 1);
  assert.equal((await cli(["plan", "--label", "latest", ...SEED_ARGS])).code, 1);
});

test("in-process: --version, --help, json format and interactive confirmation", async () => {
  const io = () => {
    const out = { stdout: "", stderr: "" };
    return {
      out,
      io: {
        stdout: (t: string) => void (out.stdout += t),
        stderr: (t: string) => void (out.stderr += t),
        env: {},
        stdoutIsTTY: false,
        stdinIsTTY: true,
        ask: async () => "no",
      },
    };
  };

  const v = io();
  assert.equal(await main(["--version"], v.io), 0);
  assert.equal(v.out.stdout, `${VERSION}\n`);

  const h = io();
  assert.equal(await main(["--help"], h.io), 0);
  assert.match(h.out.stdout, /promptplan plan/);

  const j = io();
  assert.equal(await main(["plan", "--format", "json", "--dir", PROMPTS_DIR, "--mock-state", SEED_FILE], j.io), 0);
  assert.equal((JSON.parse(j.out.stdout) as { planVersion: number }).planVersion, 1);

  // 대화형 apply 에서 "yes" 가 아니면 취소(1), 상태 파일은 그대로
  const before = await readFile(SEED_FILE, "utf8");
  const a = io();
  assert.equal(await main(["apply", "--dir", PROMPTS_DIR, "--mock-state", SEED_FILE], a.io), 1);
  assert.match(a.out.stdout, /Apply cancelled/);
  assert.equal(await readFile(SEED_FILE, "utf8"), before);
});

test("mock command serves the seed until stopped, then closes", async () => {
  let out = "";
  let listed = 0;
  const code = await main(["mock", "--port", "0", "--seed", SEED_FILE], {
    stdout: (t) => void (out += t),
    stderr: (t) => void (out += t),
    env: {},
    stdoutIsTTY: false,
    stdinIsTTY: false,
    // "Ctrl+C" 대신: 화면에 나온 주소로 목록을 한 번 받아 본 뒤 멈춘다
    waitForStop: async () => {
      const url = /LANGFUSE_BASE_URL=(\S+)/.exec(out)?.[1];
      assert.ok(url, out);
      const response = await fetch(`${url}/api/public/v2/prompts`, { headers: { authorization: "Basic cGs6c2s=" } });
      listed = ((await response.json()) as { data: unknown[] }).data.length;
    },
  });
  assert.equal(code, 0);
  assert.equal(listed, 5);
  assert.match(out, /practice mock/);
});

test("--env-file supplies keys and the process environment wins", async () => {
  await withTempDir(async (dir) => {
    const { loadEnvFile, resolveConnection } = await import("../src/config.js");
    const file = path.join(dir, ".env");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, "LANGFUSE_PUBLIC_KEY=pk-lf-file\nLANGFUSE_SECRET_KEY=sk-lf-file\nLANGFUSE_BASE_URL=https://us.cloud.langfuse.com/\n");
    const env = await loadEnvFile(file, { LANGFUSE_PUBLIC_KEY: "pk-lf-env" });
    const connection = resolveConnection({ env });
    assert.equal(connection.kind, "real");
    if (connection.kind === "real") {
      assert.equal(connection.publicKey, "pk-lf-env");
      assert.equal(connection.secretKey, "sk-lf-file");
      assert.equal(connection.baseUrl, "https://us.cloud.langfuse.com");
      assert.equal(connection.target, "Langfuse at us.cloud.langfuse.com");
    }
    assert.equal(resolveConnection({ env: { LANGFUSE_PUBLIC_KEY: "a", LANGFUSE_SECRET_KEY: "b" } }).target, "Langfuse at cloud.langfuse.com");
  });
});
