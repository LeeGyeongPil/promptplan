import assert from "node:assert/strict";
import { test } from "node:test";
import { runDemo } from "../src/demo.js";

test("demo shows plan, apply and an idempotent second plan in order", async () => {
  let out = "";
  const code = await runDemo({ write: (t) => (out += t) });
  assert.equal(code, 0);
  const first = out.indexOf("Plan: 1 to create, 1 new version, 1 label move, 2 unchanged");
  const applied = out.indexOf("Applied: 2 created versions, 1 label move");
  const none = out.indexOf("No changes");
  assert.ok(first >= 0 && applied > first && none > applied, out);
  assert.match(out, /drift legal\/disclaimer/);
  assert.match(out, /practice mock/);
  // 비교 없이 POST 하는 스크립트는 버전을 쌓고, promptplan 은 두 번째 실행에서 0개
  assert.match(out, /10 → 20 versions after 2 runs/);
  assert.match(out, /10 → 12 → 12 versions/);
  assert.ok(!out.includes("127.0.0.1"));
});
