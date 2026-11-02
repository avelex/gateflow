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

  const a = db.addAction({ thread_id: t, email: "kaja@example.com", kind: "create_invoice", params: { gateway: 0, amount: "1" }, summary: "Create invoice" });
  assert.deepEqual(db.action(a, "kaja@example.com"), { id: a, thread_id: t, email: "kaja@example.com", kind: "create_invoice", params: { gateway: 0, amount: "1" }, summary: "Create invoice", status: "pending", result: null });
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

// ---------- write proposals ----------

import { writeTools } from "./chat.ts";

function proposing(over: Partial<Merchant> = {}) {
  const deps = fakeDeps();
  chain(deps);
  const threadId = deps.db.createThread("kaja@example.com", "t", NOW_SEC);
  const propose = (name: string, args: any) => writeTools(deps)[name].run(args, kaja(over), threadId);
  return { deps, threadId, propose };
}

test("create_invoice_proposal_normalized", async () => {
  const { deps, threadId, propose } = proposing();
  const out: any = await propose("create_invoice", { token: "nBTC", amount: "0.01", expires_in: 1 });
  assert.deepEqual(out, { actionId: 1, summary: "Create invoice 0.01 nBTC, expires in 1 hour" });
  assert.deepEqual(deps.db.action(1, "kaja@example.com"), {
    id: 1,
    thread_id: threadId,
    email: "kaja@example.com",
    kind: "create_invoice",
    params: { gateway: 0, token: "nbtc.testnet", amount: "1000000", expires_in_sec: 3600 },
    summary: "Create invoice 0.01 nBTC, expires in 1 hour",
    status: "pending",
    result: null,
  });
  const memo: any = await propose("create_invoice", { token: "usdc.testnet", amount: "12.5", expires_in: 48, memo: "  table 4 " });
  assert.equal(memo.summary, 'Create invoice 12.5 USDC, expires in 48 hours, memo "table 4"');
  assert.deepEqual(deps.db.action(memo.actionId, "kaja@example.com")!.params, { gateway: 0, token: "usdc.testnet", amount: "12500000", expires_in_sec: 172800, memo: "table 4" });
});

test("create_invoice_too_precise_rejected", async () => {
  const { deps, propose } = proposing();
  const out: any = await propose("create_invoice", { token: "nBTC", amount: "0.000000001", expires_in: 1 });
  assert.match(out.error, /at most 8 decimals/);
  assert.ok("error" in ((await propose("create_invoice", { token: "nBTC", amount: "0", expires_in: 1 })) as any));
  assert.ok("error" in ((await propose("create_invoice", { token: "nBTC", amount: "0.01", expires_in: 721 })) as any));
  assert.ok("error" in ((await propose("create_invoice", { token: "nBTC", amount: "0.01", expires_in: 0.5 })) as any));
  assert.equal(deps.db.action(1, "kaja@example.com"), undefined);
});

test("create_invoice_memo_too_long_rejected", async () => {
  const { deps, propose } = proposing();
  const out: any = await propose("create_invoice", { token: "nBTC", amount: "0.01", expires_in: 1, memo: "é".repeat(100) });
  assert.match(out.error, /140 bytes/);
  assert.equal(deps.db.action(1, "kaja@example.com"), undefined);
});

test("create_invoice_disabled_token_rejected", async () => {
  const { deps, propose } = proposing({ tokens_off: ["nbtc.testnet"] });
  assert.match(((await propose("create_invoice", { token: "nBTC", amount: "0.01", expires_in: 1 })) as any).error, /switched off/);
  assert.match(((await propose("create_invoice", { token: "DOGE", amount: "1", expires_in: 1 })) as any).error, /not accepted/);
  assert.equal(deps.db.action(1, "kaja@example.com"), undefined);
});

test("risk_out_of_range_rejected", async () => {
  const { deps, propose } = proposing();
  assert.ok("error" in ((await propose("set_risk_tolerance", { max_risk: 81 })) as any));
  assert.ok("error" in ((await propose("set_risk_tolerance", { max_risk: -1 })) as any));
  assert.ok("error" in ((await propose("set_risk_tolerance", { max_risk: 2.5 })) as any));
  assert.equal(deps.db.action(1, "kaja@example.com"), undefined);
  assert.deepEqual(await propose("set_risk_tolerance", { max_risk: 20 }), { actionId: 1, summary: "Set risk tolerance to 20 (now 50)" });
  assert.deepEqual(deps.db.action(1, "kaja@example.com")!.params, { gateway: 0, policy: { max_risk: 20 } });
  assert.equal(deps.db.action(1, "kaja@example.com")!.kind, "set_policy");
});

test("retry_not_failed_rejected", async () => {
  const { deps, propose } = proposing();
  assert.match(((await propose("retry_payment", { id: 0 })) as any).error, /only failed/);
  assert.deepEqual(await propose("retry_payment", { id: 3 }), { error: "not found" });
  assert.equal(deps.db.action(1, "kaja@example.com"), undefined);
  assert.deepEqual(await propose("retry_payment", { id: 2 }), { actionId: 1, summary: "Retry payment #2 of 0.000001 nBTC" });
  assert.deepEqual(deps.db.action(1, "kaja@example.com")!.params, { payment: 2 });
});

// ---------- assistant loop and chat routes ----------

import { chatRoutes, runAssistant } from "./chat.ts";
import { dispatch } from "./main.ts";
import { SESSION_COOKIE } from "./console.ts";
import { req } from "./testing.ts";

const toolCall = (name: string, args: unknown, id = "c1") => ({ toolCalls: [{ id, name, arguments: typeof args === "string" ? args : JSON.stringify(args) }] });

/// Kaja signed in with gateway 0 and the chain fixture; returns her cookies.
function chatting(over: Partial<Merchant> = {}) {
  const deps = fakeDeps();
  chain(deps);
  deps.db.upsertMerchant(kaja(over));
  deps.db.createSession("tok", "kaja@example.com", 0);
  const cookies = { [SESSION_COOKIE]: "tok" };
  const post = (body: any) => dispatch(chatRoutes, req("POST", "/console/chat", body, cookies), deps);
  const get = (path: string) => dispatch(chatRoutes, req("GET", path, undefined, cookies), deps);
  return { deps, cookies, post, get };
}

test("loop_stops_after_six_rounds", async () => {
  const deps = fakeDeps();
  chain(deps);
  for (let i = 0; i < 10; i++) deps.llm.replies.push(toolCall("gateway_settings", {}, `c${i}`));
  deps.llm.replies.splice(6, 0, { content: "Here is what I found." });
  const turn = await runAssistant({ llm: deps.llm, tools: readTools(deps), threadId: 1, system: "sys" }, kaja(), [], "hi");
  assert.equal(deps.llm.calls.length, 7);
  assert.equal(deps.llm.calls[6].tools.length, 0);
  assert.equal(deps.llm.calls[5].messages.filter((m) => m.role === "tool").length, 5);
  assert.equal(turn.text, "Here is what I found.");
});

test("malformed_tool_args_reported", async () => {
  const deps = fakeDeps();
  chain(deps);
  deps.llm.replies.push(toolCall("get_invoice", "{id: 0"), { content: "Sorry." });
  const turn = await runAssistant({ llm: deps.llm, tools: readTools(deps), threadId: 1, system: "sys" }, kaja(), [], "hi");
  const toolMsg = deps.llm.calls[1].messages.at(-1)!;
  assert.equal(toolMsg.role, "tool");
  assert.equal(toolMsg.tool_call_id, "c1");
  assert.deepEqual(JSON.parse(toolMsg.content!), { error: "arguments are not valid JSON" });
  assert.equal(turn.text, "Sorry.");
});

test("model_error_returns_unavailable", async () => {
  const { deps, post } = chatting();
  deps.llm.replies.push(new Error("model endpoint 503"));
  const res = await post({ message: "Which invoices are unpaid?" });
  assert.equal(res.status, 200);
  const reply = (res.json as any).messages.at(-1);
  assert.equal(reply.role, "assistant");
  assert.equal(reply.text, "The assistant is unavailable right now");
});

test("daily_limit_429", async () => {
  const { deps, post } = chatting();
  deps.cfg.chatDailyLimit = 2;
  assert.equal((await post({ message: "one" })).status, 200);
  assert.equal((await post({ message: "two" })).status, 200);
  const before = deps.llm.calls.length;
  assert.equal((await post({ message: "three" })).status, 429);
  assert.equal(deps.llm.calls.length, before);
  deps.clock.ms += 86400_000;
  assert.equal((await post({ message: "next day" })).status, 200);
});

test("chat_not_configured_503", async () => {
  const { deps, post } = chatting();
  deps.llm = undefined as any;
  assert.deepEqual(await post({ message: "hi" }), { status: 503, json: { error: "assistant not configured" } });
});

test("foreign_thread_404", async () => {
  const { deps, post, get } = chatting();
  const other = deps.db.createThread("bob@example.com", "Bob's", 0);
  assert.equal((await post({ threadId: other, message: "hi" })).status, 404);
  assert.equal((await get(`/console/thread?id=${other}`)).status, 404);
  assert.equal((await post({ message: "" })).status, 400);
  assert.equal((await post({ message: "x".repeat(4001) })).status, 400);
});

test("thread_created_and_listed", async () => {
  const { deps, post, get } = chatting();
  const res = await post({ message: "Generate invoice for 0.01 BTC and send it to the cafe on the corner please" });
  const { threadId, messages } = res.json as any;
  assert.deepEqual(messages.map((m: any) => m.role), ["user", "assistant"]);
  const list = (await get("/console/threads")).json as any[];
  assert.deepEqual(list.map((t) => [t.id, t.title]), [[threadId, "Generate invoice for 0.01 BTC and send it to the cafe on the"]]);
  await post({ threadId, message: "and again" });
  const one = (await get(`/console/thread?id=${threadId}`)).json as any;
  assert.equal(one.messages.length, 4);
  // History is replayed as text: system, 3 earlier messages, then the new one.
  assert.deepEqual(deps.llm.calls.at(-1)!.messages.map((m) => m.role), ["system", "user", "assistant", "user"]);
  assert.match(deps.llm.calls[0].messages[0].content!, /nBTC \(8 decimals, nbtc.testnet\)/);
  assert.match(deps.llm.calls[0].messages[0].content!, /2026-11-02/);
});

test("history_capped_at_30", async () => {
  const { deps, post } = chatting();
  const t = deps.db.createThread("kaja@example.com", "long", 0);
  for (let i = 0; i < 40; i++) deps.db.addMessage({ thread_id: t, role: i % 2 ? "assistant" : "user", text: `m${i}`, trace: [], cards: [], created_at: 0 });
  await post({ threadId: t, message: "latest" });
  const sent = deps.llm.calls[0].messages;
  assert.equal(sent.length, 31);
  assert.equal(sent.at(-1)!.content, "latest");
  assert.equal(sent[1].content, "m11");
});

test("trace_groups_tools", async () => {
  const { deps, post } = chatting();
  deps.llm.replies.push(
    { toolCalls: [{ id: "a", name: "list_invoices", arguments: "{}" }, { id: "b", name: "get_invoice", arguments: '{"id":0}' }] },
    toolCall("list_payments", {}),
    { content: "Two unpaid." },
  );
  const reply = ((await post({ message: "Which invoices are unpaid?" })).json as any).messages.at(-1);
  assert.deepEqual(reply.trace, ["invoices", "payments"]);
  assert.deepEqual(reply.cards, [{ type: "status", invoiceId: 0 }]);
  assert.equal(reply.text, "Two unpaid.");
});

test("confirm_card_attached_for_proposal", async () => {
  const { deps, post } = chatting();
  deps.llm.replies.push(toolCall("create_invoice", { token: "nBTC", amount: "0.01" }), { content: "Please confirm the card." });
  const reply = ((await post({ message: "Generate invoice for 0.01 BTC" })).json as any).messages.at(-1);
  assert.deepEqual(reply.cards, [{ type: "confirm", actionId: 1 }]);
  assert.deepEqual(reply.trace, ["invoices"]);
  assert.equal(deps.db.action(1, "kaja@example.com")!.status, "pending");
  const toolResult = JSON.parse(deps.llm.calls[1].messages.at(-1)!.content!);
  assert.deepEqual(toolResult, { actionId: 1, summary: "Create invoice 0.01 nBTC, expires in 1 hour" });
});

// ---------- confirm-bound actions ----------

import { generateKeyPairSync } from "node:crypto";
import { consoleRoutes } from "./console.ts";
import { decodeSignedDelegate, signDelegate } from "./delegate.ts";
import { type Action, secretFromSeed, signer } from "./near.ts";

const TGAS = 10n ** 12n;
const secret = secretFromSeed(new Uint8Array(generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).subarray(16)));
const fnCall = (method: string, args: object): Action => ({ functionCall: { method, args, gas: 30n * TGAS, deposit: 0n } });
const signed = (actions: Action[]) =>
  signDelegate({ senderId: "kaja-coffee.op.testnet", receiverId: "gateflow.testnet", actions, nonce: 2n, maxBlockHeight: 1120n, publicKey: signer(secret).publicKey }, secret);
const invoiceParams = { gateway: 0, token: "nbtc.testnet", amount: "1000000", expires_in_sec: 3600 };

/// Kaja with one pending create_invoice action in a thread.
async function withAction(kind: "create_invoice" | "set_policy" | "retry" = "create_invoice", params: any = invoiceParams) {
  const c = chatting();
  const threadId = c.deps.db.createThread("kaja@example.com", "t", 0);
  const actionId = c.deps.db.addAction({ thread_id: threadId, email: "kaja@example.com", kind, params, summary: "s" });
  const relay = (actions: Action[], id: unknown = actionId) =>
    dispatch(consoleRoutes, req("POST", "/console/relay", { signedDelegate: signed(actions), actionId: id }, c.cookies), c.deps);
  const action = (path: string, body: any) => dispatch(chatRoutes, req("POST", path, body, c.cookies), c.deps);
  return { ...c, threadId, actionId, relay, action };
}

test("decoded_function_call_has_args", () => {
  const d = decodeSignedDelegate(signed([fnCall("create_invoice", invoiceParams)]));
  const a = d.actions[0];
  assert.equal(a.kind, "functionCall");
  assert.deepEqual(JSON.parse(new TextDecoder().decode((a as any).args)), invoiceParams);
});

test("relay_action_args_match_executes", async () => {
  const { deps, relay, actionId } = await withAction();
  deps.near.sendResults.push(() => ({ hash: "tx1", value: 7 }));
  const res = await relay([fnCall("create_invoice", { expires_in_sec: 3600, amount: "1000000", token: "nbtc.testnet", gateway: 0 })]);
  assert.deepEqual(res, { status: 200, json: { txHash: "tx1", value: 7 }, headers: undefined });
  assert.equal(deps.near.sent.length, 1);
  assert.deepEqual(deps.db.action(actionId, "kaja@example.com")!.status, "done");
  assert.deepEqual(deps.db.action(actionId, "kaja@example.com")!.result, { txHash: "tx1", value: 7 });
});

test("relay_action_args_mismatch_refused", async () => {
  const { deps, relay, actionId } = await withAction();
  const tampered = await relay([fnCall("create_invoice", { ...invoiceParams, amount: "9000000" })]);
  assert.equal(tampered.status, 403);
  const two = await relay([fnCall("create_invoice", invoiceParams), fnCall("create_invoice", invoiceParams)]);
  assert.equal(two.status, 403);
  const other = await relay([fnCall("set_policy", { gateway: 0, policy: { max_risk: 0 } })]);
  assert.equal(other.status, 403);
  assert.equal((await relay([fnCall("create_invoice", invoiceParams)], 99)).status, 404);
  assert.equal(deps.near.sent.length, 0);
  assert.equal(deps.db.action(actionId, "kaja@example.com")!.status, "pending");
});

test("action_claimed_once", async () => {
  const { deps, relay } = await withAction();
  const [a, b] = await Promise.all([relay([fnCall("create_invoice", invoiceParams)]), relay([fnCall("create_invoice", invoiceParams)])]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(deps.near.sent.length, 1);
  assert.equal((await relay([fnCall("create_invoice", invoiceParams)])).status, 409);
});

test("retry_action_confirm_uses_operator", async () => {
  const { deps, action, actionId, relay } = await withAction("retry", { payment: 2 });
  assert.equal((await relay([fnCall("create_invoice", invoiceParams)])).status, 400);
  const res = await action("/console/actions/confirm", { id: actionId });
  assert.equal(res.status, 200);
  assert.equal(deps.near.sent.length, 1);
  assert.equal(deps.near.sent[0].receiver, "gateflow.testnet");
  assert.deepEqual((deps.near.sent[0].actions[0] as any).functionCall.args, { payment: 2 });
  assert.equal(deps.db.action(actionId, "kaja@example.com")!.status, "done");
  assert.equal((await action("/console/actions/confirm", { id: actionId })).status, 409);
  assert.equal(deps.near.sent.length, 1);
});

test("passkey_action_not_confirmable_without_passkey", async () => {
  const { deps, action, actionId } = await withAction();
  assert.equal((await action("/console/actions/confirm", { id: actionId })).status, 400);
  assert.equal(deps.near.sent.length, 0);
});

test("dismiss_sets_dismissed", async () => {
  const { deps, action, actionId, relay, get } = await withAction();
  assert.equal((await action("/console/actions/dismiss", { id: actionId })).status, 200);
  assert.equal(deps.db.action(actionId, "kaja@example.com")!.status, "dismissed");
  assert.equal((await relay([fnCall("create_invoice", invoiceParams)])).status, 409);
  assert.equal((await action("/console/actions/dismiss", { id: actionId })).status, 409);
  const shown = (await get(`/console/action?id=${actionId}`)).json as any;
  assert.deepEqual(shown, { id: actionId, kind: "create_invoice", params: invoiceParams, summary: "s", status: "dismissed", result: null });
  assert.equal(deps.near.sent.length, 0);
});

test("action_of_other_merchant_not_found", async () => {
  const { deps, action, get } = await withAction();
  const bobs = deps.db.addAction({ thread_id: 99, email: "bob@example.com", kind: "retry", params: { payment: 2 }, summary: "s" });
  assert.equal((await get(`/console/action?id=${bobs}`)).status, 404);
  assert.equal((await action("/console/actions/dismiss", { id: bobs })).status, 404);
  assert.equal((await action("/console/actions/confirm", { id: bobs })).status, 404);
});

test("failed_tx_marks_failed", async () => {
  const { deps, relay, actionId } = await withAction();
  deps.near.sendResults.push(() => ({ hash: "tx1", error: "invalid expiry" }));
  const res = await relay([fnCall("create_invoice", invoiceParams)]);
  assert.equal(res.status, 422);
  const a = deps.db.action(actionId, "kaja@example.com")!;
  assert.equal(a.status, "failed");
  assert.deepEqual(a.result, { error: "invalid expiry" });
});

test("outcome_message_appended", async () => {
  const { deps, relay, threadId } = await withAction();
  deps.near.sendResults.push(() => ({ hash: "tx1", value: 7 }));
  await relay([fnCall("create_invoice", invoiceParams)]);
  const last = deps.db.messages(threadId, 1)[0];
  assert.equal(last.role, "assistant");
  assert.equal(last.text, "Invoice #7 created");
  assert.deepEqual(last.cards, [{ type: "invoice", invoiceId: 7 }]);
  assert.equal(deps.llm.calls.length, 0);

  const r = await withAction("set_policy", { gateway: 0, policy: { max_risk: 20 } });
  await r.relay([fnCall("set_policy", { gateway: 0, policy: { max_risk: 20 } })]);
  assert.equal(r.deps.db.messages(r.threadId, 1)[0].text, "Risk tolerance set to 20");

  const t = await withAction("retry", { payment: 2 });
  await t.action("/console/actions/confirm", { id: t.actionId });
  const out = t.deps.db.messages(t.threadId, 1)[0];
  assert.equal(out.text, "Retry of payment #2 requested");
  assert.deepEqual(out.cards, [{ type: "status", invoiceId: 1 }]);
});
