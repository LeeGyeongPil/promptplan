// promptplan demo — 계정 없이 30초 안에 plan → apply → plan 흐름을 보여 준다.
// 연습용 목(메모리 가짜 Langfuse)을 127.0.0.1 임의 포트에 띄우고, CLI 와 같은 HTTP 클라이언트로 실제 요청을 보낸다.
// 고정 출력을 찍는 게 아니라 목 서버의 규칙(POST 는 언제나 새 버전, 라벨은 한 버전에만)이 결과를 만든다.
// 포트 번호·절대 경로는 출력하지 않는다(실행마다 같은 화면).

import { fileURLToPath } from "node:url";
import path from "node:path";
import { applyPlan } from "./apply.js";
import { createClient } from "./client.js";
import { loadPromptDir } from "./files.js";
import { createPlan } from "./planner.js";
import { renderApplyText, renderPlanText } from "./render/text.js";
import { readMockState, startMockServer, type MockServer, type MockState } from "./mock/server.js";

export const EXAMPLES_DIR = fileURLToPath(new URL("../../examples/", import.meta.url));

export interface DemoOptions {
  write: (text: string) => void;
  color?: boolean;
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
  const seed = await readMockState(path.join(EXAMPLES_DIR, "remote-seed.json"));
  const { specs, errors } = await loadPromptDir(path.join(EXAMPLES_DIR, "prompts"));
  const target = "practice mock (demo)";

  write("promptplan demo — practice mock mode\n");
  write("  The 'remote' is an in-memory fake of the Langfuse prompt API, not the real server.\n");
  write("  Files:  examples/prompts/   Remote start state: examples/remote-seed.json (not modified)\n\n");

  const mock = await startMockServer({ seed });
  try {
    const api = createClient({ baseUrl: mock.url, publicKey: "pk-lf-practice", secretKey: "sk-lf-practice" });
    const versionsAtStart = countVersions(mock.snapshot());

    write("== 1/4  plan: what would change? ==\n\n");
    const first = await createPlan(specs, errors, api, { target });
    write(renderPlanText(first, { color: options.color }));
    if (first.errors.length > 0) return 1;

    write("\n== 2/4  apply: send only what changed ==\n\n");
    const before = countWrites(mock);
    const result = await applyPlan(first, api, { message: "demo" });
    write(renderApplyText(result, { color: options.color }));
    const after = countWrites(mock);
    write(`  requests sent: ${after.post - before.post} POST, ${after.patch - before.patch} PATCH\n`);
    if (result.failed) return 1;
    const versionsAfterApply = countVersions(mock.snapshot());

    write("\n== 3/4  plan again: nothing left to do ==\n\n");
    const second = await createPlan(specs, errors, api, { target });
    write(renderPlanText(second, { color: options.color }));
    const again = await applyPlan(second, api, { message: "demo" });
    write(`  apply again: ${again.createdVersions} new versions, ${again.labelMoves} label moves (idempotent)\n`);
    const versionsAfterSecond = countVersions(mock.snapshot());

    write("\n== 4/4  why compare first? ==\n\n");
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
      write(`  A script that POSTs every file on every CI run:  ${versionsAtStart} → ${naiveVersions} versions after 2 runs\n`);
      write(`  promptplan apply, then apply again:              ${versionsAtStart} → ${versionsAfterApply} → ${versionsAfterSecond} versions\n`);
      write("  Langfuse makes a new version on every POST, even with identical content — so compare first.\n");
    } finally {
      await naive.close();
    }

    write("\nTry it yourself: npx promptplan plan --dir examples/prompts --mock-state examples/remote-seed.json\n");
    return 0;
  } finally {
    await mock.close();
  }
}
