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
import { errorText, isLang, langFlagFromArgv, PromptplanError, resolveLang, t, type Lang, type Params, type MsgKey } from "./i18n.js";
import { loadPromptDir } from "./files.js";
import { readMockState, startMockServer, writeMockState } from "./mock/server.js";
import { createPlan, hasChanges } from "./planner.js";
import { pullPrompts } from "./pull.js";
import { renderPlanJson } from "./render/json.js";
import { renderPlanMarkdown } from "./render/markdown.js";
import { renderApplyText, renderPlanText } from "./render/text.js";
import { labelIssue } from "./validate.js";

export const VERSION = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

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

/** parseArgs 의 영어 오류를 고른 언어로 바꾼다. 영어면 Node 의 원래 문장 그대로. */
function parseErrorText(error: unknown, lang: Lang): string {
  const original = error instanceof Error ? error.message : String(error);
  if (lang === "en") return original;
  const code = (error as { code?: string }).code;
  const option = /'([^']*)'/.exec(original)?.[1] ?? "";
  const key: MsgKey =
    code === "ERR_PARSE_ARGS_UNKNOWN_OPTION"
      ? "cli.parseUnknownOption"
      : code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE"
        ? "cli.parseBadOptionValue"
        : code === "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL"
          ? "cli.parseUnexpectedPositional"
          : "cli.parseOther";
  const params: Params = key === "cli.parseOther" ? { message: original } : { option };
  return t(lang, key, params);
}

export async function main(argv: string[], io: CliIO): Promise<number> {
  // 언어는 parseArgs 보다 먼저 정한다 — 인자 오류 문구도 고른 언어로 내기 위해서다.
  let lang = resolveLang(langFlagFromArgv(argv), io.env);
  const say = (key: MsgKey, params?: Params): string => t(lang, key, params);
  const fail = (message: string): number => {
    io.stderr(say("cli.errorLine", { message }));
    return 1;
  };
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
        lang: { type: "string" },
        port: { type: "string" },
        seed: { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (error) {
    io.stderr(say("cli.errorLine", { message: parseErrorText(error, lang) }) + say("cli.helpHint"));
    return 1;
  }
  const { values, positionals } = parsed;
  if (values.lang !== undefined && !isLang(values.lang)) return fail(`${t("en", "cli.langInvalid")} / ${t("ko", "cli.langInvalid")}`);
  lang = resolveLang(values.lang, io.env);
  const command = positionals[0];

  if (values.version) {
    io.stdout(`${VERSION}\n`);
    return 0;
  }
  if (values.help || command === undefined || command === "help") {
    io.stdout(say("help", { version: VERSION }));
    return command === undefined && !values.help ? 1 : 0;
  }
  if (positionals.length > 1) {
    return fail(say("cli.unexpectedArg", { arg: positionals[1] ?? "" }));
  }

  const color = io.stdoutIsTTY && !values["no-color"] && !io.env["NO_COLOR"];

  try {
    if (command === "demo") return await runDemo({ write: io.stdout, color, lang });
    if (command === "mock") return await runMock(values.port, values.seed, io, lang);
    if (command !== "plan" && command !== "apply" && command !== "pull") {
      return fail(say("cli.unknownCommand", { command }));
    }

    const labels = splitLabels(values.label);
    for (const label of labels ?? []) {
      const issue = labelIssue(label);
      if (issue) throw new PromptplanError("cli.labelFlag", { issue });
    }
    if (command === "pull" && labels && labels.length !== 1) throw new PromptplanError("cli.pullOneLabel");
    const format = values.format ?? "text";
    if (!["text", "markdown", "json"].includes(format)) throw new PromptplanError("cli.formatInvalid");
    if (command !== "plan" && values.format !== undefined) throw new PromptplanError("cli.formatOnlyPlan");

    let env = io.env;
    if (values["env-file"]) env = await loadEnvFile(values["env-file"], env);
    const connection = resolveConnection({ mockState: values["mock-state"], env });
    const dir = values.dir ?? "prompts";

    const session = await openSession(connection);
    try {
      if (command === "pull") {
        const result = await pullPrompts(session.api, { dir, label: labels?.[0] ?? "production", force: values.force ?? false });
        for (const file of result.written) io.stdout(say("pull.wrote", { file }));
        for (const file of result.skipped) io.stdout(say("pull.kept", { file }));
        if (result.missingLabel.length > 0)
          io.stdout(say("pull.noLabel", { label: labels?.[0] ?? "production", list: result.missingLabel.join(", ") }));
        if (result.unsafe.length > 0) io.stdout(say("pull.unsafe", { list: result.unsafe.join(", ") }));
        io.stdout(say("pull.summary", { written: result.written.length, kept: result.skipped.length }));
        return 0;
      }

      const { specs, errors } = await loadPromptDir(dir);
      const plan = await createPlan(specs, errors, session.api, { target: connection.target, targetMsg: connection.targetMsg, labelOverride: labels });

      if (command === "plan") {
        if (format === "json") io.stdout(renderPlanJson(plan));
        else if (format === "markdown") io.stdout(renderPlanMarkdown(plan, { lang }));
        else io.stdout(renderPlanText(plan, { color, lang }));
        if (plan.errors.length > 0) return 1;
        return values["detailed-exitcode"] && hasChanges(plan) ? 2 : 0;
      }

      // ---- apply ----
      io.stdout(renderPlanText(plan, { color, lang }));
      if (plan.errors.length > 0) return 1;
      if (!hasChanges(plan)) return 0;
      if (!values.yes) {
        if (!io.stdinIsTTY) {
          return fail(say("cli.applyNeedsYes"));
        }
        const answer = await (io.ask ?? askOnStdin)(say("cli.askApply"));
        if (answer.trim() !== "yes") {
          io.stdout(say("cli.applyCancelled"));
          return 1;
        }
      }
      io.stdout("\n");
      const result = await applyPlan(plan, session.api, { message: values.message, env });
      io.stdout(renderApplyText(result, { color, lang }));
      if (connection.kind === "mock" && result.steps.length > 0) {
        await session.save();
        io.stdout(say("cli.mockStateWritten", { file: values["mock-state"] ?? "" }));
      }
      return result.failed ? 1 : 0;
    } finally {
      await session.close();
    }
  } catch (error) {
    return fail(errorText(error, lang));
  }
}

async function runMock(port: string | undefined, seedFile: string | undefined, io: CliIO, lang: Lang): Promise<number> {
  const portNumber = Number(port ?? 3999);
  if (!Number.isInteger(portNumber) || portNumber < 0 || portNumber > 65535) throw new PromptplanError("cli.portRange");
  const seed = seedFile ? await readMockState(seedFile) : undefined;
  const mock = await startMockServer({ seed, port: portNumber });
  io.stdout(t(lang, "mock.title"));
  io.stdout(t(lang, "mock.url", { url: mock.url }));
  io.stdout(t(lang, "mock.stop"));
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
