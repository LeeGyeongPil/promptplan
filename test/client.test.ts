import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient, LangfuseApiError, retryAfterMs } from "../src/client.js";
import { startMockServer } from "../src/mock/server.js";
import { loadSeed, withMock } from "./helpers.js";

test("client encodes folder names and returns null for missing prompts", async () => {
  await withMock(await loadSeed(), async ({ mock, api }) => {
    const got = await api.getPrompt("qa/answer", { label: "production" });
    assert.equal(got?.version, 1);
    assert.equal(mock.requests.at(-1)?.path, "/api/public/v2/prompts/qa%2Fanswer");
    assert.equal(await api.getPrompt("missing/prompt", { version: 1 }), null);
  });
});

test("client retries 429 and GET 5xx, but never re-sends a POST after 5xx", async () => {
  await withMock(await loadSeed(), async ({ mock, api }) => {
    mock.failNext(429, { "retry-after": "0" });
    mock.failNext(503);
    const list = await api.listPrompts();
    assert.equal(list.length, 5);

    // POST 5xx: 서버가 이미 버전을 만들었을 수 있으니 다시 보내지 않는다
    mock.failNext(503);
    const postsBefore = mock.requests.filter((r) => r.method === "POST").length;
    await assert.rejects(
      api.createPrompt({ name: "x/y", type: "text", prompt: "hi", labels: [] }),
      (error: unknown) => error instanceof LangfuseApiError && error.status === 503,
    );
    assert.equal(mock.requests.filter((r) => r.method === "POST").length, postsBefore + 1);

    // POST 429: 처리되지 않았으므로 다시 보낸다
    mock.failNext(429, { "retry-after": "0" });
    const created = await api.createPrompt({ name: "x/y", type: "text", prompt: "hi", labels: [] });
    assert.equal(created.version, 1);
  });
});

test("client gives up after the retry limit and explains 401", async () => {
  const mock = await startMockServer();
  try {
    let waits = 0;
    const api = createClient({ baseUrl: mock.url, publicKey: "pk", secretKey: "sk", retries: 2, sleep: async () => void waits++ });
    for (let i = 0; i < 3; i++) mock.failNext(502);
    await assert.rejects(api.listPrompts(), /Langfuse API 502/);
    assert.equal(waits, 2);
    mock.failNext(401);
    await assert.rejects(api.listPrompts(), /check LANGFUSE_PUBLIC_KEY/);
  } finally {
    await mock.close();
  }
});

test("Retry-After accepts seconds and HTTP dates", () => {
  assert.equal(retryAfterMs("2", 0), 2000);
  assert.equal(retryAfterMs(null, 0), null);
  assert.equal(retryAfterMs("soon", 0), null);
  assert.equal(retryAfterMs(new Date(5000).toUTCString(), 0), 5000);
});
