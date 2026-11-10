import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { unifiedDiff } from "../src/diff.js";
import { loadPromptDir } from "../src/files.js";
import { contentKey } from "../src/normalize.js";
import { createPlan } from "../src/planner.js";
import type { PromptApi } from "../src/client.js";
import type { RemotePrompt, RemotePromptMeta } from "../src/types.js";
import { withTempDir } from "./helpers.js";

// 원격 응답을 그대로 흉내 내는 아주 작은 가짜 API — 목 서버가 정리해 버리는 값(config: null 등)까지 넣을 수 있다.
function fakeApi(prompts: RemotePrompt[]): PromptApi {
  return {
    async listPrompts(): Promise<RemotePromptMeta[]> {
      return prompts.map((p) => ({ name: p.name, type: p.type, versions: [p.version], labels: p.labels, tags: p.tags }));
    },
    async getPrompt(name, select) {
      const p = prompts.find((x) => x.name === name);
      if (!p) return null;
      if ("version" in select) return select.version === p.version ? p : null;
      return p.labels.includes(select.label) ? p : null;
    },
    async createPrompt() {
      throw new Error("plan must not write");
    },
    async updateLabels() {
      throw new Error("plan must not write");
    },
  };
}

const remote = (name: string, type: "text" | "chat", prompt: unknown, config: unknown): RemotePrompt => ({
  name,
  version: 1,
  type,
  prompt,
  config,
  labels: ["latest", "production"],
  tags: [],
  commitMessage: "[promptplan] apply",
});

test("no false diffs for chatmessage type, config null/{} and key order, trailing newline", async () => {
  await withTempDir(async (dir) => {
    await mkdir(path.join(dir, "v"), { recursive: true });
    // 1) chat: 파일에는 type 이 없고 원격에는 "chatmessage" 가 붙어 있다
    await writeFile(
      path.join(dir, "v", "chat-type.yaml"),
      'labels: [production]\nmessages:\n  - role: system\n    content: Be kind.\n  - placeholder: history\n  - role: user\n    content: "{{q}}"\n',
    );
    // 2) config: 파일에 없음 ↔ 원격 null, 파일 {} ↔ 원격 {}
    await writeFile(path.join(dir, "v", "config-null.md"), "---\nlabels: [production]\n---\nHello\n");
    await writeFile(path.join(dir, "v", "config-empty.md"), "---\nlabels: [production]\nconfig: {}\n---\nHello\n");
    // 3) config 키 순서가 다르다
    await writeFile(path.join(dir, "v", "config-order.md"), "---\nlabels: [production]\nconfig: { temperature: 0, model: m }\n---\nHello\n");
    // 4) 본문 끝 줄바꿈(파일은 여러 개 + CRLF, 원격은 없음)
    await writeFile(path.join(dir, "v", "trailing.md"), "---\r\nlabels: [production]\r\n---\r\nLine one\r\nLine two\r\n\r\n");

    const api = fakeApi([
      remote(
        "v/chat-type",
        "chat",
        [
          { role: "system", content: "Be kind.", type: "chatmessage" },
          { type: "placeholder", name: "history" },
          { role: "user", content: "{{q}}", type: "chatmessage" },
        ],
        {},
      ),
      remote("v/config-null", "text", "Hello", null),
      remote("v/config-empty", "text", "Hello", {}),
      remote("v/config-order", "text", "Hello", { model: "m", temperature: 0 }),
      remote("v/trailing", "text", "Line one\nLine two", {}),
    ]);

    const { specs, errors } = await loadPromptDir(dir);
    assert.deepEqual(errors, []);
    assert.equal(specs.length, 5);
    const plan = await createPlan(specs, errors, api, { target: "test" });
    assert.deepEqual(plan.errors, []);
    for (const change of plan.changes) {
      assert.equal(change.action, "unchanged", `${change.name} should be unchanged`);
      assert.deepEqual(change.diff, []);
    }
  });
});

test("contentKey treats real changes as changes", () => {
  assert.notEqual(contentKey("text", "Hello", {}), contentKey("text", "Hello!", {}));
  assert.notEqual(contentKey("text", "Hello", { temperature: 0 }), contentKey("text", "Hello", { temperature: 1 }));
  assert.notEqual(
    contentKey("chat", [{ role: "user", content: "a" }], {}),
    contentKey("chat", [{ role: "system", content: "a" }], {}),
  );
  // 앞쪽 공백·줄 가운데 빈 줄은 내용이다
  assert.notEqual(contentKey("text", " Hello", {}), contentKey("text", "Hello", {}));
});

test("unified diff marks removed and added lines with correct hunk headers", () => {
  assert.deepEqual(unifiedDiff(["a", "b", "c"], ["a", "b", "c"]), []);
  assert.deepEqual(unifiedDiff(["a", "b", "c"], ["a", "x", "c"]), ["@@ -1,3 +1,3 @@", " a", "-b", "+x", " c"]);
  assert.deepEqual(unifiedDiff([], ["new"]), ["@@ -0,0 +1,1 @@", "+new"]);
  // 멀리 떨어진 변경은 hunk 두 개
  const a = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
  const b = ["one", "2", "3", "4", "5", "6", "7", "8", "9", "ten"];
  assert.equal(unifiedDiff(a, b, { context: 1 }).filter((l) => l.startsWith("@@")).length, 2);
});
