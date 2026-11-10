import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPlan, commitMessageFor } from "../src/apply.js";
import { hasChanges } from "../src/planner.js";
import { renderApplyText, summaryLine } from "../src/render/text.js";
import { loadSeed, planDir, PROMPTS_DIR, versionCounts, withMock, writes } from "./helpers.js";

test("apply sends only needed requests and is idempotent", async () => {
  await withMock(await loadSeed(), async ({ mock, api }) => {
    const plan = await planDir(PROMPTS_DIR, api);
    const result = await applyPlan(plan, api, { env: {} });
    assert.equal(result.failed, null);
    assert.equal(renderApplyText(result).trim().split("\n").at(-1), "Applied: 2 created versions, 1 label move");

    const sent = writes(mock.requests);
    const posts = sent.filter((r) => r.method === "POST");
    const patches = sent.filter((r) => r.method === "PATCH");
    assert.equal(posts.length, 2);
    assert.equal(patches.length, 1);
    assert.equal(patches[0]?.path, "/api/public/v2/prompts/qa%2Fanswer/versions/2");
    assert.deepEqual(patches[0]?.body, { newLabels: ["production"] });
    for (const post of posts) {
      const body = post.body as { commitMessage?: string; labels?: string[] };
      assert.ok(body.commitMessage?.startsWith("[promptplan] "), String(body.commitMessage));
      assert.ok(!body.labels?.includes("latest"));
    }
    // 프론트매터 commitMessage 가 쓰인다
    const welcome = posts.find((p) => (p.body as { name: string }).name === "onboarding/welcome");
    assert.equal((welcome?.body as { commitMessage: string }).commitMessage, "[promptplan] add onboarding welcome message");

    // 두 번째 plan: 할 일 없음
    const second = await planDir(PROMPTS_DIR, api);
    assert.match(summaryLine(second), /^Plan: 0 to create, 0 new versions, 0 label moves, 5 unchanged$/);
    assert.equal(hasChanges(second), false);

    // 두 번째 apply: 원격을 바꾸는 요청 0건
    const before = writes(mock.requests).length;
    const again = await applyPlan(second, api, { env: {} });
    assert.equal(again.createdVersions + again.labelMoves, 0);
    assert.equal(writes(mock.requests).length, before);
  });
});

test("promoting with --label production only moves labels", async () => {
  await withMock(await loadSeed(), async ({ mock, api }) => {
    // 1) staging 에 먼저 배포
    const staging = await applyPlan(await planDir(PROMPTS_DIR, api, ["staging"]), api, { env: {} });
    assert.equal(staging.failed, null);
    assert.ok(staging.createdVersions > 0);
    const countsAfterStaging = versionCounts(mock.snapshot());

    // 2) 같은 파일로 production 승격 → 새 버전 없이 PATCH 만
    const writesBefore = writes(mock.requests).length;
    const promotePlan = await planDir(PROMPTS_DIR, api, ["production"]);
    assert.equal(promotePlan.summary.create + promotePlan.summary.newVersion, 0);
    const promote = await applyPlan(promotePlan, api, { env: {} });
    assert.equal(promote.failed, null);
    const sent = writes(mock.requests).slice(writesBefore);
    assert.equal(sent.filter((r) => r.method === "POST").length, 0);
    assert.ok(sent.length > 0);
    assert.ok(sent.every((r) => r.method === "PATCH"));
    for (const r of sent) assert.deepEqual(r.body, { newLabels: ["production"] });
    assert.deepEqual(versionCounts(mock.snapshot()), countsAfterStaging);

    // 3) production 이 staging 과 같은 버전을 가리킨다
    const state = mock.snapshot();
    for (const name of ["onboarding/welcome", "support/greeting", "qa/answer"]) {
      const versions = state.prompts.find((p) => p.name === name)?.versions ?? [];
      const prod = versions.find((v) => v.labels?.includes("production"));
      const stag = versions.find((v) => v.labels?.includes("staging"));
      assert.ok(prod && stag && prod.version === stag.version, name);
    }
  });
});

test("apply stops at the first error and reports what is left", async () => {
  await withMock(await loadSeed(), async ({ mock, api }) => {
    const plan = await planDir(PROMPTS_DIR, api);
    mock.failNext(403); // 다음 요청(onboarding/welcome POST)을 보호 라벨 거부처럼 실패시킨다
    const result = await applyPlan(plan, api, { env: {} });
    assert.equal(result.failed?.name, "onboarding/welcome");
    assert.match(result.failed?.message ?? "", /403/);
    assert.deepEqual(result.remaining, ["qa/answer", "support/greeting"]);
    assert.equal(result.steps.length, 0);
    assert.match(renderApplyText(result), /Not attempted: qa\/answer, support\/greeting/);
  });
});

test("commit message: --message, then file, then GITHUB_SHA, then plain apply", () => {
  assert.equal(commitMessageFor(undefined, { env: {} }), "[promptplan] apply");
  assert.equal(commitMessageFor(undefined, { env: { GITHUB_SHA: "0123456789abcdef" } }), "[promptplan] apply 0123456");
  assert.equal(commitMessageFor("from file", { env: { GITHUB_SHA: "0123456789abcdef" } }), "[promptplan] from file");
  assert.equal(commitMessageFor("from file", { message: "cli", env: {} }), "[promptplan] cli");
});
