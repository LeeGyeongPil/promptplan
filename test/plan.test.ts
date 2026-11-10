import assert from "node:assert/strict";
import { test } from "node:test";
import { renderPlanText, summaryLine } from "../src/render/text.js";
import { loadSeed, planDir, PROMPTS_DIR, withMock, writes } from "./helpers.js";

test("classifies create, new version, label move, unchanged and drift", async () => {
  await withMock(await loadSeed(), async ({ mock, api }) => {
    const plan = await planDir(PROMPTS_DIR, api);
    assert.deepEqual(plan.errors, []);

    const byName = Object.fromEntries(plan.changes.map((c) => [c.name, c]));
    assert.equal(byName["onboarding/welcome"]?.action, "create");
    assert.equal(byName["onboarding/welcome"]?.targetVersion, 1);

    assert.equal(byName["support/greeting"]?.action, "new-version");
    assert.equal(byName["support/greeting"]?.targetVersion, 3);
    assert.deepEqual(byName["support/greeting"]?.labels, ["staging"]);

    assert.equal(byName["qa/answer"]?.action, "move");
    assert.deepEqual(byName["qa/answer"]?.labelMoves, [{ label: "production", from: 1, to: 2 }]);

    assert.equal(byName["faq/short"]?.action, "unchanged");
    assert.equal(byName["legal/disclaimer"]?.action, "unchanged");
    assert.equal(byName["legal/disclaimer"]?.targetVersion, 3);

    // 드리프트: UI 에서 만든 legal/disclaimer v4 하나만
    const drift = plan.changes.flatMap((c) => c.warnings.filter((w) => w.kind === "drift").map((w) => ({ name: c.name, w })));
    assert.equal(drift.length, 1);
    assert.equal(drift[0]?.name, "legal/disclaimer");
    assert.match(drift[0]?.w.message ?? "", /^latest v4 was created outside promptplan/);

    assert.deepEqual(plan.unmanaged, ["experiments/tone-test"]);
    assert.equal(summaryLine(plan), "Plan: 1 to create, 1 new version, 1 label move, 2 unchanged");

    const text = renderPlanText(plan);
    assert.match(text, /^~ support\/greeting {2}new version v3 \(labels: staging\)$/m);
    assert.match(text, /^> qa\/answer {2}move production v1 → v2$/m);
    assert.match(text, /! drift legal\/disclaimer: latest v4 was created outside promptplan/);

    // plan 은 읽기만 한다
    assert.deepEqual(writes(mock.requests), []);
    // 비교용 조회는 resolve=false 로, 폴더 이름은 %2F 로 인코딩
    const gets = mock.requests.filter((r) => r.method === "GET" && r.path !== "/api/public/v2/prompts");
    assert.ok(gets.length > 0);
    for (const r of gets) {
      assert.equal(r.query["resolve"], "false");
      assert.ok(!r.path.slice("/api/public/v2/prompts/".length).includes("/"), r.path);
    }
  });
});

test("warns when template variables are removed or added", async () => {
  await withMock(await loadSeed(), async ({ api }) => {
    const plan = await planDir(PROMPTS_DIR, api);
    const greeting = plan.changes.find((c) => c.name === "support/greeting");
    const messages = greeting?.warnings.map((w) => w.message) ?? [];
    assert.ok(
      messages.some((m) => m.startsWith("variable removed: topic")),
      `expected a "variable removed: topic" warning, got ${JSON.stringify(messages)}`,
    );
    // 라벨 이동도 그 라벨을 쓰는 앱이 받는 내용을 바꾸므로 비교한다(qa/answer production v1 → v2 에 history 추가)
    const qa = plan.changes.find((c) => c.name === "qa/answer");
    assert.ok(qa?.warnings.some((w) => w.kind === "placeholder-added" && w.message.startsWith("placeholder added: history")));
    // 변수가 그대로면 경고가 없다
    const faq = plan.changes.find((c) => c.name === "faq/short");
    assert.deepEqual(faq?.warnings, []);
  });
});

test("tags differences are reported and only sent with a new version", async () => {
  const seed = await loadSeed();
  const faq = seed.prompts.find((p) => p.name === "faq/short");
  assert.ok(faq);
  faq.tags = ["old-tag"];
  await withMock(seed, async ({ api }) => {
    const plan = await planDir(PROMPTS_DIR, api);
    // faq/short 파일에는 tags 가 없다 → 원격 tags 를 건드리지 않고 경고도 없다
    assert.deepEqual(plan.changes.find((c) => c.name === "faq/short")?.warnings, []);
    // support/greeting 은 tags 가 같다 → tags 경고 없음
    assert.ok(!plan.changes.find((c) => c.name === "support/greeting")?.warnings.some((w) => w.kind === "tags"));
  });
  const legal = seed.prompts.find((p) => p.name === "legal/disclaimer");
  assert.ok(legal);
  legal.tags = ["compliance"];
  await withMock(seed, async ({ api }) => {
    const plan = await planDir(PROMPTS_DIR, api);
    const warning = plan.changes.find((c) => c.name === "legal/disclaimer")?.warnings.find((w) => w.kind === "tags");
    assert.match(warning?.message ?? "", /only updates tags when a new version is created/);
  });
});
