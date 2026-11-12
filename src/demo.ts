// promptplan demo — 계정 없이 30초 안에 plan → apply → plan 흐름을 보여 준다.
// 연습용 목(메모리 가짜 Langfuse)을 127.0.0.1 임의 포트에 띄우고, CLI 와 같은 HTTP 클라이언트로 실제 요청을 보낸다.
// 고정 출력을 찍는 게 아니라 목 서버의 규칙(POST 는 언제나 새 버전, 라벨은 한 버전에만)이 결과를 만든다.
// 포트 번호·절대 경로는 출력하지 않는다(실행마다 같은 화면).

import { fileURLToPath } from "node:url";
import path from "node:path";
import { applyPlan } from "./apply.js";
import { createClient } from "./client.js";
import { msg, t, type Lang } from "./i18n.js";
import { loadPromptDir } from "./files.js";
import { createPlan } from "./planner.js";
import { renderApplyText, renderPlanText } from "./render/text.js";
import { readMockState, startMockServer, type MockServer, type MockState } from "./mock/server.js";

export const EXAMPLES_DIR = fileURLToPath(new URL("../../examples/", import.meta.url));

export interface DemoOptions {
  write: (text: string) => void;
  color?: boolean;
  /** 화면 언어(기본 en) */
  lang?: Lang;
}

function countVersions(state: MockState): number {
  return state.prompts.reduce((sum, prompt) => sum + prompt.versions.length, 0);
}

function countWrites(mock: MockServer): { post: number; patch: number } {
  return {
    post: mock.requests.filter((r) => r.method === "POST").length,
    patch: mock.requests.filter((r) => r.method === "PATCH").length,
  };
}

export async function runDemo(options: DemoOptions): Promise<number> {
  const write = options.write;
  const lang = options.lang ?? "en";
  const render = { color: options.color, lang };
  const seed = await readMockState(path.join(EXAMPLES_DIR, "remote-seed.json"));
  const { specs, errors } = await loadPromptDir(path.join(EXAMPLES_DIR, "prompts"));
  const target = "practice mock (demo)";
  const targetMsg = msg("target.demo");

  write(t(lang, "demo.title"));
  write(t(lang, "demo.fake"));
  write(t(lang, "demo.files"));

  const mock = await startMockServer({ seed });
  try {
    const api = createClient({ baseUrl: mock.url, publicKey: "pk-lf-practice", secretKey: "sk-lf-practice" });
    const versionsAtStart = countVersions(mock.snapshot());

    write(t(lang, "demo.step1"));
    const first = await createPlan(specs, errors, api, { target, targetMsg });
    write(renderPlanText(first, render));
    if (first.errors.length > 0) return 1;

    write(t(lang, "demo.step2"));
    const before = countWrites(mock);
    const result = await applyPlan(first, api, { message: "demo" });
    write(renderApplyText(result, render));
    const after = countWrites(mock);
    write(t(lang, "demo.requests", { post: after.post - before.post, patch: after.patch - before.patch }));
    if (result.failed) return 1;
    const versionsAfterApply = countVersions(mock.snapshot());

    write(t(lang, "demo.step3"));
    const second = await createPlan(specs, errors, api, { target, targetMsg });
    write(renderPlanText(second, render));
    const again = await applyPlan(second, api, { message: "demo" });
    write(t(lang, "demo.applyAgain", { created: again.createdVersions, moves: again.labelMoves }));
    const versionsAfterSecond = countVersions(mock.snapshot());

    write(t(lang, "demo.step4"));
    // 비교 없이 매번 POST 하는 흔한 배포 스크립트를 같은 시작 상태의 다른 목에서 두 번 돌려 본다.
    const naive = await startMockServer({ seed });
    try {
      const naiveApi = createClient({ baseUrl: naive.url, publicKey: "pk-lf-practice", secretKey: "sk-lf-practice" });
      for (let run = 0; run < 2; run++)
        for (const spec of specs)
          await naiveApi.createPrompt({
            name: spec.name,
            type: spec.type,
            prompt: spec.prompt,
            ...(spec.config ? { config: spec.config } : {}),
            labels: spec.labels,
          });
      const naiveVersions = countVersions(naive.snapshot());
      write(t(lang, "demo.naive", { start: versionsAtStart, naive: naiveVersions }));
      write(t(lang, "demo.smart", { start: versionsAtStart, applied: versionsAfterApply, second: versionsAfterSecond }));
      write(t(lang, "demo.why"));
    } finally {
      await naive.close();
    }

    write(t(lang, "demo.tryIt"));
    return 0;
  } finally {
    await mock.close();
  }
}
