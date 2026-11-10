import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { pullPrompts } from "../src/pull.js";
import { hasChanges } from "../src/planner.js";
import { renderPlanText } from "../src/render/text.js";
import { loadSeed, planDir, withMock, withTempDir, writes } from "./helpers.js";

test("pull then plan reports no changes", async () => {
  await withTempDir(async (dir) => {
    await withMock(await loadSeed(), async ({ mock, api }) => {
      const result = await pullPrompts(api, { dir, label: "production" });
      assert.deepEqual(result.written, ["faq/short.md", "legal/disclaimer.md", "qa/answer.yaml", "support/greeting.md"]);
      assert.deepEqual(result.missingLabel, ["experiments/tone-test"]);

      // text 는 프론트매터 .md, chat 은 .yaml (플레이스홀더 없는 v1 이 production)
      const text = await readFile(path.join(dir, "support", "greeting.md"), "utf8");
      assert.match(text, /^---\nlabels:\n {2}- production\n/);
      assert.match(text, /\n---\nHello \{\{name\}\}, how can I help with \{\{topic\}\}\?\n$/);
      const chat = await readFile(path.join(dir, "qa", "answer.yaml"), "utf8");
      assert.match(chat, /messages:\n {2}- role: system\n/);

      // 받은 파일로 plan → 변경 없음
      const plan = await planDir(dir, api);
      assert.deepEqual(plan.errors, []);
      assert.equal(hasChanges(plan), false);
      assert.match(renderPlanText(plan), /\nNo changes\. Langfuse already matches your files\.\n$/);

      // 사람이 고친 파일은 --force 없이 덮지 않는다
      const edited = path.join(dir, "faq", "short.md");
      await writeFile(edited, "---\nlabels: [production]\n---\nEdited by hand\n");
      const again = await pullPrompts(api, { dir, label: "production" });
      assert.deepEqual(again.written, []);
      assert.ok(again.skipped.includes("faq/short.md"));
      assert.equal(await readFile(edited, "utf8"), "---\nlabels: [production]\n---\nEdited by hand\n");

      // --force 면 덮는다
      const forced = await pullPrompts(api, { dir, label: "production", force: true });
      assert.ok(forced.written.includes("faq/short.md"));
      assert.match(await readFile(edited, "utf8"), /Answer the question in one sentence/);

      // pull 은 원격을 바꾸지 않는다
      assert.deepEqual(writes(mock.requests), []);
    });
  });
});

test("pull round-trips chat placeholders, multi-line text and labels of another version", async () => {
  await withTempDir(async (dir) => {
    await withMock(await loadSeed(), async ({ api }) => {
      const result = await pullPrompts(api, { dir, label: "staging" });
      assert.deepEqual(result.written, ["qa/answer.yaml", "support/greeting.md"]);
      assert.match(await readFile(path.join(dir, "qa", "answer.yaml"), "utf8"), /- placeholder: history/);
      const plan = await planDir(dir, api);
      assert.equal(hasChanges(plan), false, renderPlanText(plan));
    });
  });
});
