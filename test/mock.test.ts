// 연습용 목이 README 가 가르치는 Langfuse 규칙을 실제로 재현하는지 확인한다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { withMock } from "./helpers.js";

async function call(url: string, method: string, path: string, body?: unknown, auth = true) {
  const response = await fetch(url + path, {
    method,
    headers: { ...(auth ? { authorization: "Basic cGs6c2s=" } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

test("mock: same content POSTed twice makes two versions, latest moves automatically", async () => {
  await withMock(undefined, async ({ mock }) => {
    const body = { name: "a/b", type: "text", prompt: "same", labels: ["staging"] };
    assert.equal((await call(mock.url, "POST", "/api/public/v2/prompts", body)).status, 201);
    const second = await call(mock.url, "POST", "/api/public/v2/prompts", body);
    assert.equal(second.json["version"], 2);
    assert.deepEqual(second.json["labels"], ["latest", "staging"]);
    const v1 = await call(mock.url, "GET", "/api/public/v2/prompts/a%2Fb?version=1");
    assert.deepEqual(v1.json["labels"], []); // staging·latest 모두 v2 로 옮겨 갔다
  });
});

test("mock: PATCH newLabels adds labels and takes them from other versions", async () => {
  await withMock(undefined, async ({ mock }) => {
    await call(mock.url, "POST", "/api/public/v2/prompts", { name: "p", prompt: "one", labels: ["production", "staging"] });
    await call(mock.url, "POST", "/api/public/v2/prompts", { name: "p", prompt: "two", labels: [] });
    const patched = await call(mock.url, "PATCH", "/api/public/v2/prompts/p/versions/2", { newLabels: ["production"] });
    assert.deepEqual(patched.json["labels"], ["latest", "production"]);
    const v1 = await call(mock.url, "GET", "/api/public/v2/prompts/p?version=1");
    assert.deepEqual(v1.json["labels"], ["staging"]); // union: v1 의 staging 은 남는다
  });
});

test("mock: rejects type change, latest label and bad labels; 404 and 401 bodies", async () => {
  await withMock(undefined, async ({ mock }) => {
    await call(mock.url, "POST", "/api/public/v2/prompts", { name: "t", type: "text", prompt: "x" });
    assert.equal((await call(mock.url, "POST", "/api/public/v2/prompts", { name: "t", type: "chat", prompt: [] })).status, 400);
    assert.equal((await call(mock.url, "POST", "/api/public/v2/prompts", { name: "t", prompt: "x", labels: ["latest"] })).status, 400);
    assert.equal((await call(mock.url, "PATCH", "/api/public/v2/prompts/t/versions/1", { newLabels: ["Bad Label"] })).status, 400);
    assert.equal((await call(mock.url, "GET", "/api/public/v2/prompts/t?version=1&label=production")).status, 400);
    const missing = await call(mock.url, "GET", "/api/public/v2/prompts/nope");
    assert.equal(missing.status, 404);
    assert.equal(missing.json["error"], "LangfusePromptNotFoundError");
    // label 도 version 도 없으면 production — t 에는 production 이 없다
    assert.equal((await call(mock.url, "GET", "/api/public/v2/prompts/t")).status, 404);
    assert.equal((await call(mock.url, "GET", "/api/public/v2/prompts", undefined, false)).status, 401);
  });
});
