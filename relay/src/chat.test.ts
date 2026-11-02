import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./db.ts";
import { llmClient } from "./chat.ts";
import { loadConfig } from "./types.ts";

// ---------- storage and model client ----------

test("chat_tables_roundtrip", () => {
  const db = openDb(":memory:");
  const t = db.createThread("kaja@example.com", "Generate invoice", 100);
  db.createThread("bob@example.com", "Other", 101);
  assert.deepEqual(db.thread(t, "kaja@example.com"), { id: t, email: "kaja@example.com", title: "Generate invoice", created_at: 100 });
  assert.equal(db.thread(t, "bob@example.com"), undefined);
  assert.deepEqual(db.threadsOf("kaja@example.com", 10).map((x) => x.title), ["Generate invoice"]);

  db.addMessage({ thread_id: t, role: "user", text: "hi", trace: [], cards: [], created_at: 100 });
  db.addMessage({ thread_id: t, role: "assistant", text: "hello", trace: ["invoices"], cards: [{ type: "invoice", invoiceId: 3 }], created_at: 101 });
  db.addMessage({ thread_id: t, role: "user", text: "again", trace: [], cards: [], created_at: 200 });
  const last2 = db.messages(t, 2);
  assert.deepEqual(last2.map((m) => m.text), ["hello", "again"]);
  assert.deepEqual(last2[0].cards, [{ type: "invoice", invoiceId: 3 }]);
  assert.deepEqual(last2[0].trace, ["invoices"]);
  assert.equal(db.userMessagesSince("kaja@example.com", 150), 1);
  assert.equal(db.userMessagesSince("kaja@example.com", 0), 2);

  const a = db.addAction({ thread_id: t, email: "kaja@example.com", kind: "create_invoice", params: { gateway: 0, amount: "1" } });
  assert.deepEqual(db.action(a, "kaja@example.com"), { id: a, thread_id: t, email: "kaja@example.com", kind: "create_invoice", params: { gateway: 0, amount: "1" }, status: "pending", result: null });
  assert.equal(db.action(a, "bob@example.com"), undefined);
  assert.equal(db.claimAction(a), true);
  assert.equal(db.claimAction(a), false);
  db.finishAction(a, "failed", { error: "boom" });
  assert.deepEqual(db.action(a, "kaja@example.com")!.result, { error: "boom" });
  assert.equal(db.action(a, "kaja@example.com")!.status, "failed");
});

test("llm_config_defaults", () => {
  const c = loadConfig({ GATEFLOW_CONTRACT: "g" });
  assert.equal(c.llmBaseUrl, "https://cloud-api.near.ai/v1");
  assert.equal(c.llmApiKey, undefined);
  assert.equal(c.chatDailyLimit, 200);
  assert.equal(loadConfig({ GATEFLOW_CONTRACT: "g", CHAT_DAILY_LIMIT: "5", LLM_MODEL: "m" }).chatDailyLimit, 5);
});

test("complete_sends_tools_without_strict", async () => {
  const calls: { url: string; init: any }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any) => {
    calls.push({ url, init });
    const message = { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_invoice", arguments: '{"id":3}' } }] };
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
  }) as any;
  try {
    const llm = llmClient({ llmBaseUrl: "https://llm.test/v1", llmApiKey: "k", llmModel: "m1" });
    const tools = [{ name: "get_invoice", description: "d", parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } }];
    const out = await llm.complete([{ role: "user", content: "hi" }], tools);
    assert.deepEqual(out, { content: undefined, toolCalls: [{ id: "c1", name: "get_invoice", arguments: '{"id":3}' }] });
    assert.equal(calls[0].url, "https://llm.test/v1/chat/completions");
    assert.equal(calls[0].init.headers.authorization, "Bearer k");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.model, "m1");
    assert.deepEqual(body.tools, [{ type: "function", function: tools[0] }]);
    assert.ok(!JSON.stringify(body).includes("strict"));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("complete_throws_on_http_error", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("down", { status: 503 })) as any;
  try {
    const llm = llmClient({ llmBaseUrl: "https://llm.test/v1", llmApiKey: "k", llmModel: "m1" });
    await assert.rejects(llm.complete([], []), /503/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
