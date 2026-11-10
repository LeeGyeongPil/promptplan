#!/usr/bin/env node
// promptplan CLI — 명령·옵션을 읽고, 연결(실제 Langfuse 또는 연습용 목)을 열고, 종료 코드를 정한다.
// 종료 코드: 0 = 성공(plan 은 변경이 있어도 0), 2 = plan --detailed-exitcode 에서 변경 있음, 1 = 오류.

import { readFileSync, realpathSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { applyPlan } from "./apply.js";
import { createClient, type PromptApi } from "./client.js";
import { loadEnvFile, resolveConnection, type Connection, type Env } from "./config.js";
import { runDemo } from "./demo.js";
import { loadPromptDir } from "./files.js";
import { readMockState, startMockServer, writeMockState } from "./mock/server.js";
import { createPlan, hasChanges } from "./planner.js";
import { pullPrompts } from "./pull.js";
import { renderPlanJson } from "./render/json.js";
import { renderPlanMarkdown } from "./render/markdown.js";
import { renderApplyText, renderPlanText } from "./render/text.js";
import { labelProblem } from "./validate.js";

export const VERSION = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

const HELP = `promptplan ${VERSION} — Git-first prompt deployment for Langfuse

Usage
  promptplan plan  [--dir prompts] [--label <l>]... [--format text|markdown|json]
                   [--detailed-exitcode] [--mock-state <file>] [--env-file <file>] [--no-color]
  promptplan apply [--dir prompts] [--label <l>]... [--yes] [--message <m>]
                   [--mock-state <file>] [--env-file <file>] [--no-color]
  promptplan pull  [--dir prompts] [--label production] [--force] [--mock-state <file>] [--env-file <file>]
  promptplan mock  [--port 3999] [--seed <file>]     run the practice mock until Ctrl+C
  promptplan demo                                    plan → apply → plan against the practice mock

Options
  --dir <path>           prompt folder (.md = text prompt, .yaml/.yml = chat prompt). Default: prompts
  --label <l>            use these labels for every prompt instead of the files' labels (promotion)
  --format <f>           plan output: text (default), markdown (PR comment) or json
  --detailed-exitcode    plan exits 2 when there are changes, 0 when there are none
  --yes, -y              apply without asking (required when not in an interactive terminal)
  --message, -m <m>      commit message for new versions (stored as "[promptplan] <m>")
  --force                pull overwrites existing files
  --mock-state <file>    use the practice mock loaded from this JSON file instead of Langfuse
                         (apply writes the new mock state back to the file)
  --env-file <file>      read LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL from a file
  --no-color             plain output (also honours NO_COLOR)

Exit codes: 0 ok · 2 changes (plan --detailed-exitcode) · 1 error
`;

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Env;
  stdoutIsTTY: boolean;
  stdinIsTTY: boolean;
  /** 대화형 apply 확인. 기본은 표준 입력에서 한 줄 읽기 */
  ask?: (question: string) => Promise<string>;
  /** mock 명령이 멈출 때까지 기다리는 방법. 기본은 Ctrl+C / SIGTERM */
  waitForStop?: () => Promise<void>;
}

interface Session {
  api: PromptApi;
  /** apply 뒤 목 상태를 파일에 되쓴다(실제 모드는 아무것도 안 함) */
  save: () => Promise<void>;
  close: () => Promise<void>;
}

/** 연결 열기: 목이면 상태 파일을 읽어 127.0.0.1 임의 포트에 목 서버를 띄우고 진짜 HTTP 로 부른다. */
async function openSession(connection: Connection): Promise<Session> {
  if (connection.kind === "real") {
    const api = createClient({
      baseUrl: connection.baseUrl,
      publicKey: connection.publicKey,
      secretKey: connection.secretKey,
      userAgent: `promptplan/${VERSION}`,
    });
    return { api, save: async () => {}, close: async () => {} };
  }
  const seed = await readMockState(connection.statePath);
  const mock = await startMockServer({ seed });
  const api = createClient({ baseUrl: mock.url, publicKey: "pk-lf-practice", secretKey: "sk-lf-practice" });
  return {
    api,
    save: () => writeMockState(connection.statePath, mock.snapshot()),
    close: () => mock.close(),
  };
}

function splitLabels(values: string[] | undefined): string[] | null {
  if (!values || values.length === 0) return null;
  return values.flatMap((value) => value.split(",")).map((label) => label.trim()).filter((label) => label !== "");
}

export async function main(argv: string[], io: CliIO): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        dir: { type: "string" },
        label: { type: "string", multiple: true },
        format: { type: "string" },
        "detailed-exitcode": { type: "boolean" },
        yes: { type: "boolean", short: "y" },
        message: { type: "string", short: "m" },
        force: { type: "boolean" },
        "mock-state": { type: "string" },
        "env-file": { type: "string" },
        "no-color": { type: "boolean" },
        port: { type: "string" },
        seed: { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (error) {
    io.stderr(`promptplan: error: ${(error as Error).message}\nRun promptplan --help for usage.\n`);
    return 1;
  }
  const { values, positionals } = parsed;
  const command = positionals[0];

  if (values.version) {
    io.stdout(`${VERSION}\n`);
    return 0;
  }
  if (values.help || command === undefined || command === "help") {
    io.stdout(HELP);
    return command === undefined && !values.help ? 1 : 0;
  }
  if (positionals.length > 1) {
    io.stderr(`promptplan: error: unexpected argument "${positionals[1]}"\n`);
    return 1;
  }

  const color = io.stdoutIsTTY && !values["no-color"] && !io.env["NO_COLOR"];

  try {
    if (command === "demo") return await runDemo({ write: io.stdout, color });
    if (command === "mock") return await runMock(values.port, values.seed, io);
    if (command !== "plan" && command !== "apply" && command !== "pull") {
      io.stderr(`promptplan: error: unknown command "${command}" (plan, apply, pull, mock, demo)\n`);
      return 1;
    }

    const labels = splitLabels(values.label);
    for (const label of labels ?? []) {
      const issue = labelProblem(label);
      if (issue) throw new Error(`--label: ${issue}`);
    }
    if (command === "pull" && labels && labels.length !== 1) throw new Error("pull takes exactly one --label");
    const format = values.format ?? "text";
    if (!["text", "markdown", "json"].includes(format)) throw new Error(`--format must be text, markdown or json`);
    if (command !== "plan" && values.format !== undefined) throw new Error(`--format is only for plan`);

    let env = io.env;
    if (values["env-file"]) env = await loadEnvFile(values["env-file"], env);
    const connection = resolveConnection({ mockState: values["mock-state"], env });
    const dir = values.dir ?? "prompts";

    const session = await openSession(connection);
    try {
      if (command === "pull") {
        const result = await pullPrompts(session.api, { dir, label: labels?.[0] ?? "production", force: values.force ?? false });
        for (const file of result.written) io.stdout(`+ wrote ${file}\n`);
        for (const file of result.skipped) io.stdout(`= kept ${file} (exists; use --force to overwrite)\n`);
        if (result.missingLabel.length > 0)
          io.stdout(`  no "${labels?.[0] ?? "production"}" version: ${result.missingLabel.join(", ")}\n`);
        if (result.unsafe.length > 0) io.stdout(`  skipped names that are not safe file paths: ${result.unsafe.join(", ")}\n`);
        io.stdout(`Pulled: ${result.written.length} written, ${result.skipped.length} kept\n`);
        return 0;
      }

      const { specs, errors } = await loadPromptDir(dir);
      const plan = await createPlan(specs, errors, session.api, { target: connection.target, labelOverride: labels });

      if (command === "plan") {
        if (format === "json") io.stdout(renderPlanJson(plan));
        else if (format === "markdown") io.stdout(renderPlanMarkdown(plan));
        else io.stdout(renderPlanText(plan, { color }));
        if (plan.errors.length > 0) return 1;
        return values["detailed-exitcode"] && hasChanges(plan) ? 2 : 0;
      }

      // ---- apply ----
      io.stdout(renderPlanText(plan, { color }));
      if (plan.errors.length > 0) return 1;
      if (!hasChanges(plan)) return 0;
      if (!values.yes) {
        if (!io.stdinIsTTY) {
          io.stderr("promptplan: error: apply needs --yes when not running in an interactive terminal (for example in CI)\n");
          return 1;
        }
        const answer = await (io.ask ?? askOnStdin)("\nApply these changes? Only 'yes' is accepted: ");
        if (answer.trim() !== "yes") {
          io.stdout("Apply cancelled.\n");
          return 1;
        }
      }
      io.stdout("\n");
      const result = await applyPlan(plan, session.api, { message: values.message, env });
      io.stdout(renderApplyText(result, { color }));
      if (connection.kind === "mock" && result.steps.length > 0) {
        await session.save();
        io.stdout(`(practice mock state written back to ${values["mock-state"]})\n`);
      }
      return result.failed ? 1 : 0;
    } finally {
      await session.close();
    }
  } catch (error) {
    io.stderr(`promptplan: error: ${(error as Error).message}\n`);
    return 1;
  }
}

async function runMock(port: string | undefined, seedFile: string | undefined, io: CliIO): Promise<number> {
  const portNumber = Number(port ?? 3999);
  if (!Number.isInteger(portNumber) || portNumber < 0 || portNumber > 65535) throw new Error("--port must be 0-65535");
  const seed = seedFile ? await readMockState(seedFile) : undefined;
  const mock = await startMockServer({ seed, port: portNumber });
  io.stdout(`promptplan practice mock — a fake Langfuse prompt API (not the real server)\n`);
  io.stdout(`  LANGFUSE_BASE_URL=${mock.url}   any pk/sk keys are accepted · state lives in memory only\n`);
  io.stdout(`  Stop with Ctrl+C.\n`);
  try {
    await (io.waitForStop ?? waitForSignal)();
  } finally {
    await mock.close();
  }
  return 0;
}

function waitForSignal(): Promise<void> {
  return new Promise((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

async function askOnStdin(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

// 직접 실행했을 때만 main 을 돈다(라이브러리로 import 할 때는 돌지 않게). npm bin 은 심볼릭 링크라 실제 경로로 비교한다.
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const code = await main(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    env: process.env,
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    stdinIsTTY: Boolean(process.stdin.isTTY),
  });
  process.exitCode = code;
}
