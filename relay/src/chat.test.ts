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

// ---------- read tools ----------

import { readTools } from "./chat.ts";
import { fakeDeps, type TestDeps } from "./testing.ts";
import type { Merchant } from "./db.ts";

const NOW_SEC = Date.UTC(2026, 10, 2, 12) / 1000;

export const kaja = (over: Partial<Merchant> = {}) =>
  ({ email: "kaja@example.com", name: "Kaja Coffee", account_id: "kaja-coffee.op.testnet", public_key: "ed25519:x", gateway_id: 0, step: "done", tokens_off: [], ...over }) as Merchant & { gateway_id: number };

/// Gateway 0 with invoices and payments in two tokens (nBTC 8 decimals, USDC 6).
export function chain(deps: TestDeps, over: { invoices?: any[]; payments?: any[] } = {}) {
  const v = deps.near.viewTable;
  const invoices = over.invoices ?? [
    { gateway: 0, token: "nbtc.testnet", amount: "1000000", expires_at_sec: NOW_SEC + 3600, memo: "coffee", status: "Open", payment: null },
    { gateway: 0, token: "nbtc.testnet", amount: "2000000", expires_at_sec: NOW_SEC - 10, memo: null, status: "Open", payment: null },
    { gateway: 0, token: "usdc.testnet", amount: "10000000", expires_at_sec: NOW_SEC + 60, memo: null, status: "Paid", payment: 0 },
    { gateway: 9, token: "usdc.testnet", amount: "5", expires_at_sec: NOW_SEC + 60, memo: null, status: "Open", payment: null },
  ];
  const payments = over.payments ?? [
    { gateway: 0, invoice: 2, payer: "alice.testnet", refund_to: "alice.testnet", token: "usdc.testnet", amount: "10000000", reference: null, deposit_address: null, opened_at_sec: NOW_SEC - 60, max_risk: 50, status: "Settled" },
    { gateway: 0, invoice: 0, payer: "intents.near", refund_to: "bob.testnet", token: "usdc.testnet", amount: "5000000", reference: "r1", deposit_address: "d", opened_at_sec: NOW_SEC - 3 * 86400, max_risk: 50, status: "Settled" },
    { gateway: 0, invoice: 1, payer: "carol.testnet", refund_to: "carol.testnet", token: "nbtc.testnet", amount: "100", reference: null, deposit_address: null, opened_at_sec: NOW_SEC - 40 * 86400, max_risk: 50, status: "RefundFailed" },
    { gateway: 9, invoice: 3, payer: "eve.testnet", refund_to: "eve.testnet", token: "usdc.testnet", amount: "1", reference: null, deposit_address: null, opened_at_sec: NOW_SEC, max_risk: 50, status: "Pending" },
  ];
  const own = (list: any[]) => list.map((x, i) => [i, x] as [number, any]).filter(([, x]) => x.gateway === 0);
  v["gateflow.testnet.get_gateway"] = { owner: "kaja-coffee.op.testnet", payout_to: "kaja.testnet", policy: { max_risk: 50 }, fuel: "100000000000000000000000", invoices: own(invoices).length, payments: own(payments).length };
  v["gateflow.testnet.get_invoices"] = ({ from_index, limit }: any) => own(invoices).slice(from_index, from_index + limit);
  v["gateflow.testnet.get_payments"] = ({ from_index, limit }: any) => own(payments).slice(from_index, from_index + limit);
  v["gateflow.testnet.get_invoice"] = ({ invoice }: any) => invoices[invoice] ?? null;
  v["gateflow.testnet.get_payment"] = ({ payment }: any) => payments[payment] ?? null;
  v["gateflow.testnet.get_tokens"] = ["nbtc.testnet", "usdc.testnet"];
  v["nbtc.testnet.ft_metadata"] = { symbol: "nBTC", decimals: 8 };
  v["usdc.testnet.ft_metadata"] = { symbol: "USDC", decimals: 6 };
}

const run = (deps: TestDeps, name: string, args: any, m = kaja()) => readTools(deps)[name].run(args, m);

test("list_invoices_expired_filter", async () => {
  const deps = fakeDeps();
  chain(deps);
  const expired: any = await run(deps, "list_invoices", { status: "expired" });
  assert.deepEqual(expired.map((i: any) => i.id), [1]);
  assert.equal(expired[0].status, "expired");
  assert.equal(expired[0].amount, "0.02");
  assert.equal(expired[0].symbol, "nBTC");
  const open: any = await run(deps, "list_invoices", { status: "open" });
  assert.deepEqual(open.map((i: any) => i.id), [0]);
  const all: any = await run(deps, "list_invoices", {});
  assert.deepEqual(all.map((i: any) => i.id), [2, 1, 0]);
  assert.deepEqual(await run(deps, "list_invoices", { status: "lost" }), { error: "status must be one of open, paying, paid, returned, expired" });
});

test("get_invoice_foreign_not_found", async () => {
  const deps = fakeDeps();
  chain(deps);
  assert.deepEqual(await run(deps, "get_invoice", { id: 3 }), { error: "not found" });
  assert.deepEqual(await run(deps, "get_invoice", { id: 42 }), { error: "not found" });
  const own: any = await run(deps, "get_invoice", { id: 0 });
  assert.equal(own.id, 0);
  assert.equal(own.amount, "0.01");
  assert.equal(own.memo, "coffee");
  assert.equal(own.status, "open");
});

test("get_payment_foreign_not_found", async () => {
  const deps = fakeDeps();
  chain(deps);
  assert.deepEqual(await run(deps, "get_payment", { id: 3 }), { error: "not found" });
  const p: any = await run(deps, "get_payment", { id: 1 });
  assert.equal(p.payer, "bob.testnet");
  assert.equal(p.status, "settled");
  assert.equal(((await run(deps, "get_payment", { id: 2 })) as any).status, "failed");
  const failed: any = await run(deps, "list_payments", { status: "failed" });
  assert.deepEqual(failed.map((x: any) => x.id), [2]);
});

test("settled_totals_periods", async () => {
  const deps = fakeDeps();
  chain(deps);
  assert.deepEqual(await run(deps, "settled_totals", { period: "today" }), [{ symbol: "USDC", amount: "10" }]);
  assert.deepEqual(await run(deps, "settled_totals", { period: "7d" }), [{ symbol: "USDC", amount: "15" }]);
  assert.deepEqual(await run(deps, "settled_totals", { period: "30d" }), [{ symbol: "USDC", amount: "15" }]);
  assert.ok("error" in ((await run(deps, "settled_totals", { period: "year" })) as any));
});

test("gateway_settings_shape", async () => {
  const deps = fakeDeps();
  chain(deps);
  assert.deepEqual(await run(deps, "gateway_settings", {}), { payout_to: "kaja.testnet", max_risk: 50, fuel: "ready" });
  assert.deepEqual(await run(deps, "accepted_tokens", {}, kaja({ tokens_off: ["usdc.testnet"] })), [
    { token: "nbtc.testnet", symbol: "nBTC", decimals: 8, enabled: true },
    { token: "usdc.testnet", symbol: "USDC", decimals: 6, enabled: false },
  ]);
});
