import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "../src/cli.js";
import { loadEnvFile } from "../src/config.js";
import { runDemo } from "../src/demo.js";
import { langFlagFromArgv, langFromEnv, MESSAGES, resolveLang, t, type MsgKey } from "../src/i18n.js";
import { renderPlanJson } from "../src/render/json.js";
import { renderPlanMarkdown } from "../src/render/markdown.js";
import { renderPlanText } from "../src/render/text.js";
import { BROKEN_DIR, loadSeed, planDir, PROMPTS_DIR, SEED_FILE, withMock, withTempDir } from "./helpers.js";

/** Run the CLI in-process with an explicit environment (default: empty, so English). */
async function run(args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await main(args, {
    stdout: (text) => void (out += text),
    stderr: (text) => void (err += text),
    env,
    stdoutIsTTY: false,
    stdinIsTTY: false,
  });
  return { code, out, err };
}

const HANGUL = /[가-힣]/;
const SEED = ["--dir", PROMPTS_DIR, "--mock-state", SEED_FILE];

test("en and ko tables have exactly the same keys and the same placeholders", () => {
  const enKeys = Object.keys(MESSAGES.en).sort();
  const koKeys = Object.keys(MESSAGES.ko).sort();
  assert.deepEqual(koKeys, enKeys);
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const key of enKeys as MsgKey[])
    assert.deepEqual(placeholders(MESSAGES.ko[key]), placeholders(MESSAGES.en[key]), `placeholders differ for ${key}`);
  for (const key of enKeys as MsgKey[]) assert.ok(MESSAGES.ko[key].trim() !== "", `empty ko text for ${key}`);
});

test("Korean messages never put a final-consonant-dependent particle right after a placeholder", () => {
  // "{name}은" style sentences read wrong for names ending in a vowel, so the tables avoid them.
  const bad = /\}["'”’)\]」]*\s*(은|는|이|가|을|를|과|와|으로|로|도)/;
  for (const [key, text] of Object.entries(MESSAGES.ko)) assert.doesNotMatch(text, bad, `${key}: ${text}`);
});

test("language is chosen by --lang, then PROMPTPLAN_LANG, then LC_ALL, LC_MESSAGES, LANG", () => {
  assert.equal(resolveLang(undefined, {}), "en");
  assert.equal(resolveLang(undefined, { LANG: "ko_KR.UTF-8" }), "ko");
  assert.equal(resolveLang(undefined, { LANG: "C" }), "en");
  assert.equal(resolveLang(undefined, { LANG: "POSIX" }), "en");
  assert.equal(resolveLang(undefined, { LANG: "fr_FR.UTF-8" }), "en");
  assert.equal(resolveLang(undefined, { LANG: "" }), "en");
  // LANG < LC_MESSAGES < LC_ALL < PROMPTPLAN_LANG < --lang
  assert.equal(langFromEnv({ LANG: "ko_KR", LC_MESSAGES: "en_US" }), "en");
  assert.equal(langFromEnv({ LC_MESSAGES: "ko_KR", LC_ALL: "en_US" }), "en");
  assert.equal(langFromEnv({ LC_ALL: "ko_KR", PROMPTPLAN_LANG: "en" }), "en");
  assert.equal(langFromEnv({ LC_ALL: "en_US", PROMPTPLAN_LANG: "ko" }), "ko");
  assert.equal(langFromEnv({ LC_ALL: "", LANG: "ko_KR" }), "ko");
  assert.equal(resolveLang("en", { PROMPTPLAN_LANG: "ko" }), "en");
  assert.equal(resolveLang("ko", { PROMPTPLAN_LANG: "en" }), "ko");
  assert.equal(resolveLang("xx", { LANG: "ko_KR" }), "ko");

  assert.equal(langFlagFromArgv(["plan", "--lang", "ko"]), "ko");
  assert.equal(langFlagFromArgv(["plan", "--lang=ko"]), "ko");
  assert.equal(langFlagFromArgv(["plan", "--", "--lang", "ko"]), undefined);
  assert.equal(langFlagFromArgv(["plan", "--lang"]), undefined);
});

test("--help, argument errors and unknown commands are Korean with --lang ko, English otherwise", async () => {
  const help = await run(["--help", "--lang", "ko"]);
  assert.equal(help.code, 0);
  assert.match(help.out, /사용법/);
  assert.match(help.out, /--lang <en\|ko>/);
  const helpEn = await run(["--help"]);
  assert.match(helpEn.out, /^promptplan .* — Git-first prompt deployment for Langfuse/);
  assert.match(helpEn.out, /--lang <en\|ko>/);
  assert.doesNotMatch(helpEn.out, HANGUL);

  // parseArgs error (unknown option): the language flag after the bad option still counts
  const unknownOption = await run(["plan", "--nope", "--lang", "ko"]);
  assert.equal(unknownOption.code, 1);
  assert.match(unknownOption.err, /^promptplan: 오류: 알 수 없는 옵션: --nope\n/);
  assert.match(unknownOption.err, /promptplan --help 로 확인하세요/);
  const unknownOptionEn = await run(["plan", "--nope"]);
  assert.match(unknownOptionEn.err, /^promptplan: error: Unknown option '--nope'/);
  assert.match(unknownOptionEn.err, /Run promptplan --help for usage\.\n$/);
  assert.doesNotMatch(unknownOptionEn.err, HANGUL);

  const missingValue = await run(["plan", "--dir", "--lang=ko"]);
  assert.match(missingValue.err, /옵션 값이 올바르지 않습니다/);

  const unknownCommand = await run(["deploy", "--lang", "ko"]);
  assert.equal(unknownCommand.code, 1);
  assert.match(unknownCommand.err, /알 수 없는 명령: "deploy"/);
  assert.match((await run(["deploy"])).err, /unknown command "deploy"/);

  const extra = await run(["plan", "x", "--lang", "ko"]);
  assert.match(extra.err, /예상하지 못한 인자: "x"/);

  // environment decides when --lang is absent
  const viaEnv = await run(["deploy"], { LANG: "ko_KR.UTF-8" });
  assert.match(viaEnv.err, /알 수 없는 명령/);
  const flagWins = await run(["deploy", "--lang", "en"], { LANG: "ko_KR.UTF-8" });
  assert.match(flagWins.err, /unknown command/);
});

test("an invalid --lang value is an error with exit code 1", async () => {
  const result = await run(["plan", "--lang", "fr", ...SEED]);
  assert.equal(result.code, 1);
  assert.match(result.err, /--lang must be en or ko/);
  assert.equal(result.out, "");
});

test("plan, apply and pull messages switch language while json stays identical", async () => {
  const ko = await run(["plan", "--lang", "ko", "--no-color", ...SEED]);
  assert.equal(ko.code, 0, ko.err);
  assert.match(ko.out, /^promptplan plan · 대상: 연습용 목 \(--mock-state\) · 라벨: 파일 기준/);
  assert.match(ko.out, /계획: 생성 1개, 새 버전 1개, 라벨 이동 1개, 변경 없음 2개/);
  assert.match(ko.out, /드리프트 legal\/disclaimer: /);
  assert.match(ko.out, /변수 삭제: topic/);
  const en = await run(["plan", "--no-color", ...SEED]);
  assert.match(en.out, /Plan: 1 to create, 1 new version, 1 label move, 2 unchanged/);
  assert.doesNotMatch(en.out.replace(/^[+-].*$/gm, ""), HANGUL);

  // machine output is the same in both languages
  const jsonKo = await run(["plan", "--format", "json", "--lang", "ko", ...SEED]);
  const jsonEn = await run(["plan", "--format", "json", "--lang", "en", ...SEED]);
  assert.equal(jsonKo.out, jsonEn.out);
  assert.doesNotMatch(jsonKo.out, /i18n|targetMsg/);

  // non-interactive apply without --yes
  const needsYes = await run(["apply", "--lang", "ko", ...SEED]);
  assert.equal(needsYes.code, 1);
  assert.match(needsYes.err, /apply 에 --yes 가 필요합니다/);

  // interactive confirmation prompt and cancel message
  let asked = "";
  let out = "";
  const code = await main(["apply", "--lang", "ko", ...SEED], {
    stdout: (text) => void (out += text),
    stderr: () => {},
    env: {},
    stdoutIsTTY: false,
    stdinIsTTY: true,
    ask: async (question) => {
      asked = question;
      return "no";
    },
  });
  assert.equal(code, 1);
  assert.match(asked, /이 변경을 적용할까요\?/);
  assert.match(out, /apply 를 취소했습니다\./);
});

test("apply and pull use the chosen language and write the same files", async () => {
  await withTempDir(async (dir) => {
    const { copyFile, readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const state = path.join(dir, "state.json");
    await copyFile(SEED_FILE, state);
    const applied = await run(["apply", "--yes", "--lang", "ko", "--no-color", "--dir", PROMPTS_DIR, "--mock-state", state]);
    assert.equal(applied.code, 0, applied.err);
    assert.match(applied.out, /적용 결과: 생성된 버전 2개, 라벨 이동 1개/);
    assert.match(applied.out, /연습용 목 상태를 다음 파일에 되썼습니다/);
    const again = await run(["plan", "--lang", "ko", "--detailed-exitcode", "--dir", PROMPTS_DIR, "--mock-state", state]);
    assert.equal(again.code, 0);
    assert.match(again.out, /변경 없음\. Langfuse 가 이미 파일과 일치합니다\./);

    const pullDir = path.join(dir, "pulled");
    const pulled = await run(["pull", "--lang", "ko", "--dir", pullDir, "--mock-state", state]);
    assert.equal(pulled.code, 0, pulled.err);
    assert.match(pulled.out, /^\+ 기록함: /m);
    assert.match(pulled.out, /pull 결과: 기록 \d+개, 유지 0개/);
    const pulledAgain = await run(["pull", "--lang", "ko", "--dir", pullDir, "--mock-state", state]);
    assert.match(pulledAgain.out, /= 유지함: .* \(이미 있음, 덮어쓰려면 --force\)/);
    assert.ok((await readFile(path.join(pullDir, "faq", "short.md"), "utf8")).length > 0);
  });
});

test("user-facing error paths are localized: config, mock state, folders, validation", async () => {
  const noKeys = await run(["plan", "--lang", "ko", "--dir", PROMPTS_DIR]);
  assert.equal(noKeys.code, 1);
  assert.match(noKeys.err, /Langfuse 키를 찾을 수 없습니다/);
  assert.match(noKeys.err, /LANGFUSE_PUBLIC_KEY 와 LANGFUSE_SECRET_KEY/);

  const missingState = await run(["plan", "--lang", "ko", "--dir", PROMPTS_DIR, "--mock-state", "/nonexistent/state.json"]);
  assert.match(missingState.err, /목 상태 파일을 읽을 수 없습니다: \/nonexistent\/state\.json \(ENOENT\)/);

  await assert.rejects(loadEnvFile("/nonexistent/.env", {}), /cannot read --env-file \(ENOENT\)/);
  const envFile = await run(["plan", "--lang", "ko", "--dir", PROMPTS_DIR, "--env-file", "/nonexistent/.env"]);
  assert.match(envFile.err, /--env-file 을 읽을 수 없습니다\(ENOENT\)/);

  const noDir = await run(["plan", "--lang", "ko", "--dir", "/nonexistent/prompts", "--mock-state", SEED_FILE]);
  assert.equal(noDir.code, 1);
  assert.match(noDir.out, /x \/nonexistent\/prompts: 프롬프트 폴더를 찾을 수 없습니다/);
  assert.match(noDir.out, /오류: 발견된 문제 1건\. Langfuse 에는 아무것도 보내지 않았습니다\./);

  const broken = await run(["plan", "--lang", "ko", "--dir", BROKEN_DIR, "--mock-state", SEED_FILE]);
  assert.equal(broken.code, 1);
  assert.match(broken.out, /라벨 "latest" 는 예약어입니다/);
  assert.match(broken.out, /허용되지 않는 type 변경: text → chat/);
  assert.match(broken.out, /오류: 발견된 문제 4건\./);

  const badLabel = await run(["plan", "--lang", "ko", "--label", "Prod Ready", ...SEED]);
  assert.match(badLabel.err, /--label: 올바르지 않은 라벨: "Prod Ready"/);
  const badFormat = await run(["plan", "--lang", "ko", "--format", "xml", ...SEED]);
  assert.match(badFormat.err, /--format 값은 text, markdown, json 중 하나여야 합니다/);
  const badPort = await run(["mock", "--lang", "ko", "--port", "99999"]);
  assert.match(badPort.err, /--port 값은 0~65535 범위여야 합니다/);

  await withTempDir(async (dir) => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const path = await import("node:path");
    const bad = path.join(dir, "bad.json");
    await writeFile(bad, "{bad");
    assert.match((await run(["plan", "--lang", "ko", "--dir", PROMPTS_DIR, "--mock-state", bad])).err, /올바른 JSON 이 아닙니다/);
    const empty = path.join(dir, "empty");
    await mkdir(empty);
    const none = await run(["plan", "--lang", "ko", "--dir", empty, "--mock-state", SEED_FILE]);
    assert.match(none.out, /프롬프트 파일\(\.md, \.yaml, \.yml\)이 없습니다/);
    // file-level problems carry their key into the plan error
    const file = path.join(dir, "files");
    await mkdir(file);
    await writeFile(path.join(file, "a.md"), "---\nbogus: 1\n---\nhi\n");
    const unknownKey = await run(["plan", "--lang", "ko", "--dir", file, "--mock-state", SEED_FILE]);
    assert.match(unknownKey.out, /x a\.md: 알 수 없는 키 "bogus" \(허용: name, type, labels, config, tags, commitMessage\)/);
    const unknownKeyEn = await run(["plan", "--dir", file, "--mock-state", SEED_FILE]);
    assert.match(unknownKeyEn.out, /x a\.md: unknown key "bogus" \(allowed: name, type, labels, config, tags, commitMessage\)/);
  });
});

test("mock command banner and demo follow the language", async () => {
  let out = "";
  const code = await main(["mock", "--lang", "ko", "--port", "0", "--seed", SEED_FILE], {
    stdout: (text) => void (out += text),
    stderr: () => {},
    env: {},
    stdoutIsTTY: false,
    stdinIsTTY: false,
    waitForStop: async () => {},
  });
  assert.equal(code, 0);
  assert.match(out, /promptplan 연습용 목 — 가짜 Langfuse 프롬프트 API/);
  assert.match(out, /LANGFUSE_BASE_URL=http:\/\/127\.0\.0\.1:\d+ /);

  let demo = "";
  assert.equal(await runDemo({ write: (text) => (demo += text), lang: "ko" }), 0);
  assert.match(demo, /연습용 목 모드/);
  assert.match(demo, /계획: 생성 1개, 새 버전 1개, 라벨 이동 1개, 변경 없음 2개/);
  assert.match(demo, /적용 결과: 생성된 버전 2개, 라벨 이동 1개/);
  assert.match(demo, /보낸 요청: POST \d+개, PATCH \d+개/);
  assert.match(demo, /버전 10 → 20/);
  assert.ok(!demo.includes("127.0.0.1"));
});

test("render functions take a lang option; default output stays English", async () => {
  await withMock(await loadSeed(), async ({ api }) => {
    const plan = await planDir(PROMPTS_DIR, api);
    const english = renderPlanText(plan);
    assert.equal(renderPlanText(plan, { lang: "en" }), english);
    const korean = renderPlanText(plan, { lang: "ko" });
    assert.notEqual(korean, english);
    assert.match(korean, /변경 없음 v1 \(라벨: production\)/);
    const markdown = renderPlanMarkdown(plan, { lang: "ko" });
    assert.match(markdown, /\| \| 프롬프트 \| 변경 \|/);
    assert.match(markdown, /\*\*경고\*\*/);
    assert.equal(renderPlanMarkdown(plan, { lang: "en" }), renderPlanMarkdown(plan));
    // JSON has no language at all
    assert.equal(renderPlanJson(plan), renderPlanJson(plan));
    assert.doesNotMatch(renderPlanJson(plan), HANGUL);
  });
});

test("library exceptions keep English messages and expose a key for localization", async () => {
  const { parsePromptFile } = await import("../src/files.js");
  const { PromptplanError, errorText } = await import("../src/i18n.js");
  try {
    parsePromptFile("a.md", "---\nbogus: 1\n---\nhi\n");
    assert.fail("should throw");
  } catch (error) {
    assert.ok(error instanceof PromptplanError);
    assert.match((error as Error).message, /^unknown key "bogus" \(allowed: /);
    assert.match(errorText(error, "ko"), /^알 수 없는 키 "bogus"/);
    assert.match(errorText(error, "en"), /^unknown key "bogus"/);
  }
  // API errors localize their hint too
  const { LangfuseApiError } = await import("../src/client.js");
  const apiError = new LangfuseApiError(401, "GET", "/api/public/v2/prompts", "Unauthorized");
  assert.match(apiError.message, /^Langfuse API 401 on GET .*: Unauthorized — check LANGFUSE_PUBLIC_KEY/);
  assert.match(errorText(apiError, "ko"), /^Langfuse API 401 오류 \(GET .*\): Unauthorized — LANGFUSE_PUBLIC_KEY/);
  assert.equal(t("en", "cli.applyCancelled"), "Apply cancelled.\n");
});
