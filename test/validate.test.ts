import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { applyPlan } from "../src/apply.js";
import { main } from "../src/cli.js";
import { labelProblem, nameProblem } from "../src/validate.js";
import { BROKEN_DIR, loadSeed, planDir, SEED_FILE, withMock, writes } from "./helpers.js";

test("rejects type change, latest label, bad label, reserved name", async () => {
  await withMock(await loadSeed(), async ({ mock, api }) => {
    const plan = await planDir(BROKEN_DIR, api);
    assert.equal(plan.errors.length, 4, JSON.stringify(plan.errors, null, 2));
    const byFile = Object.fromEntries(plan.errors.map((e) => [e.file, e.message]));
    assert.match(byFile["support/greeting.yaml"] ?? "", /type change text → chat/);
    assert.match(byFile["faq/short.md"] ?? "", /"latest" is reserved/);
    assert.match(byFile["qa/bad-label.md"] ?? "", /label "Prod Ready" is invalid/);
    assert.match(byFile["new.md"] ?? "", /"new" is reserved/);
    assert.deepEqual(plan.changes, []);

    // 오류가 있는 plan 은 apply 할 수 없다 → 원격을 바꾸는 요청 0건
    await assert.rejects(applyPlan(plan, api, { env: {} }), /nothing was applied/);
    assert.deepEqual(writes(mock.requests), []);
  });

  // CLI: 종료 코드 1, 상태 파일은 그대로(목 서버에도 POST/PATCH 없음)
  const before = await readFile(SEED_FILE, "utf8");
  for (const command of ["plan", "apply"]) {
    let out = "";
    const code = await main([command, "--yes", "--dir", BROKEN_DIR, "--mock-state", SEED_FILE].filter((a) => command === "apply" || a !== "--yes"), {
      stdout: (t) => (out += t),
      stderr: (t) => (out += t),
      env: {},
      stdoutIsTTY: false,
      stdinIsTTY: false,
    });
    assert.equal(code, 1, out);
    assert.match(out, /Error: 4 problems found\. Nothing was sent to Langfuse\./);
  }
  assert.equal(await readFile(SEED_FILE, "utf8"), before);
});

test("label and name rules follow Langfuse", () => {
  assert.equal(labelProblem("production"), null);
  assert.equal(labelProblem("release-2026.01_a"), null);
  assert.ok(labelProblem("latest"));
  assert.ok(labelProblem("Production"));
  assert.ok(labelProblem("a".repeat(37)));
  assert.equal(labelProblem("a".repeat(36)), null);
  assert.ok(nameProblem("a|b"));
  assert.ok(nameProblem("metrics"));
  assert.ok(nameProblem("prompt-detail"));
  assert.equal(nameProblem("team/new"), null);
});
