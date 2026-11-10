import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { renderPlanJson } from "../src/render/json.js";
import { MARKER, renderPlanMarkdown } from "../src/render/markdown.js";
import { renderPlanText } from "../src/render/text.js";
import { loadSeed, planDir, PROMPTS_DIR, ROOT, withMock } from "./helpers.js";

const GOLDEN = path.join(ROOT, "test", "golden");

async function renderAll(): Promise<Record<string, string>> {
  return withMock(await loadSeed(), async ({ mock, api }) => {
    const plan = await planDir(PROMPTS_DIR, api);
    const out = { "plan.txt": renderPlanText(plan), "plan.md": renderPlanMarkdown(plan), "plan.json": renderPlanJson(plan) };
    // 포트가 출력에 새지 않았는지 확인하려고 이번 목의 주소를 함께 돌려준다
    return { ...out, url: mock.url };
  });
}

test("text, markdown and json output match golden files", async () => {
  const first = await renderAll();
  const second = await renderAll();

  // golden 갱신: PROMPTPLAN_UPDATE_GOLDEN=1 npm test
  if (process.env["PROMPTPLAN_UPDATE_GOLDEN"] === "1")
    for (const name of ["plan.txt", "plan.md", "plan.json"]) await writeFile(path.join(GOLDEN, name), first[name] as string);

  for (const name of ["plan.txt", "plan.md", "plan.json"]) {
    const actual = first[name] as string;
    assert.equal(actual, second[name], `${name} differs between two runs`);
    assert.equal(actual, await readFile(path.join(GOLDEN, name), "utf8"), `${name} differs from test/golden/${name}`);

    // 실행 환경에 따라 달라지는 값이 없어야 한다
    const port = new URL(first["url"] as string).port;
    assert.ok(!actual.includes(ROOT), `${name} contains the repo path`);
    assert.ok(!actual.includes(os.tmpdir()), `${name} contains the temp path`);
    assert.ok(!actual.includes("127.0.0.1") && !actual.includes(`:${port}`), `${name} contains the mock address`);
    assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(actual), `${name} contains a timestamp`);
    assert.ok(!actual.includes("\u001b["), `${name} contains colour codes`);
  }

  assert.ok((first["plan.md"] as string).startsWith(`${MARKER}\n`));
  assert.match(first["plan.md"] as string, /<details><summary><code>support\/greeting<\/code> — new version v3/);
  const json = JSON.parse(first["plan.json"] as string) as { planVersion: number; hasChanges: boolean };
  assert.equal(json.planVersion, 1);
  assert.equal(json.hasChanges, true);
});

test("markdown keeps the table and code fences intact", async () => {
  const { renderPlanMarkdown: render } = await import("../src/render/markdown.js");
  const md = render({
    target: "t",
    labelOverride: null,
    unmanaged: [],
    errors: [],
    summary: { create: 1, newVersion: 0, move: 0, unchanged: 0 },
    changes: [
      {
        name: "a|b",
        file: "a.md",
        type: "text",
        action: "create",
        targetVersion: 1,
        latestVersion: null,
        baselineVersion: null,
        labels: [],
        labelMoves: [],
        diff: ["--- x", "+++ y", "@@ -0,0 +1,1 @@", "+```js"],
        warnings: [],
        request: null,
      },
    ],
  });
  assert.match(md, /\| `a\\\|b` \|/);
  assert.match(md, /````diff\n/);
  assert.match(md, /<summary><code>a\|b<\/code>/);
});
