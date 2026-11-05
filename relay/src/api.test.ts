import { test } from "node:test";
import assert from "node:assert/strict";
import { keyHash, newApiKey, newWebhookSecret } from "./api.ts";
import { openDb } from "./db.ts";

test("api_key_format", () => {
  assert.match(newApiKey(true), /^gf_test_[0-9A-Za-z]{43}$/);
  assert.match(newApiKey(false), /^gf_live_[0-9A-Za-z]{43}$/);
  assert.notEqual(newApiKey(true), newApiKey(true));
  assert.match(newWebhookSecret(), /^whsec_[0-9A-Za-z]{43}$/);
});

test("key_hash_stable", () => {
  assert.equal(keyHash("gf_test_x"), keyHash("gf_test_x"));
  assert.match(keyHash("gf_test_x"), /^[0-9a-f]{64}$/);
  assert.notEqual(keyHash("gf_test_x"), keyHash("gf_test_y"));
});

test("revoked_key_not_found", () => {
  const db = openDb(":memory:");
  db.upsertMerchant({ email: "kaja@example.com", name: "Kaja", account_id: "kaja.op", public_key: "ed25519:x", gateway_id: 3, step: "done", tokens_off: [] });
  const h = keyHash("gf_test_k");
  db.addApiKey({ hash: h, email: "kaja@example.com", label: "shop", last4: "es_k", created_at: 1 });
  assert.equal(db.merchantByKeyHash(h)?.gateway_id, 3);
  assert.equal(db.apiKeys("kaja@example.com").length, 1);
  assert.equal(db.revokeApiKey("other@example.com", h.slice(0, 12), 2), false);
  assert.equal(db.revokeApiKey("kaja@example.com", h.slice(0, 12), 2), true);
  assert.equal(db.merchantByKeyHash(h), undefined);
  assert.deepEqual(db.apiKeys("kaja@example.com"), []);
});

import { apiStatus, fromRaw, invoiceObject, toRaw } from "./api.ts";

test("to_raw_usdc", () => {
  assert.equal(toRaw("10.00", 6), 10_000_000n);
  assert.equal(toRaw("10", 6), 10_000_000n);
  assert.equal(toRaw("0.0001", 8), 10_000n);
});

test("to_raw_rejects", () => {
  for (const bad of ["0", "0.000", "1.1234567", "abc", "-1", "1e3", "", " 1", "1."]) assert.throws(() => toRaw(bad, 6), bad);
});

test("from_raw_formats", () => {
  assert.equal(fromRaw(10_000_000n, 6), "10.00");
  assert.equal(fromRaw(1_234_567n, 6), "1.234567");
  assert.equal(fromRaw(10_000n, 8), "0.0001");
});

test("api_status_expired", () => {
  const inv = { status: "Open", expires_at_sec: 100 };
  assert.equal(apiStatus(inv, 99_999), "open");
  assert.equal(apiStatus(inv, 100_000), "expired");
  assert.equal(apiStatus({ status: "Paying", expires_at_sec: 100 }, 200_000), "paying");
  assert.equal(apiStatus({ status: "Returned", expires_at_sec: 100 }, 0), "returned");
});

test("invoice_object_shape", () => {
  const inv = { gateway: 0, token: "usdc.testnet", amount: "10000000", expires_at_sec: 1_800, memo: "order_123", status: "Open", payment: null };
  assert.deepEqual(invoiceObject(42, inv, { symbol: "USDC", decimals: 6 }, "https://gw.example/", 0), {
    id: 42, url: "https://gw.example/pay/42", status: "open", amount: "10.00", currency: "USDC", order_id: "order_123", expires_at: "1970-01-01T00:30:00.000Z",
  });
});

import { apiRoutes } from "./api.ts";
import { decodeSignedDelegate } from "./delegate.ts";
import { dispatch } from "./main.ts";
import { secretFromSeed, signer } from "./near.ts";
import { fakeDeps, merchant, req, type TestDeps } from "./testing.ts";

const SIGNER = secretFromSeed(new Uint8Array(32).fill(9));
const SIGNER_PUB = signer(SIGNER).publicKeyString;

/// A merchant with the API enabled, a live key, USDC and BTC allowlisted, and a fake chain that stores created invoices.
function apiSetup(opts: { enabled?: boolean; tokensOff?: string[] } = {}) {
  const deps = fakeDeps({ invoiceSigner: SIGNER, publicUrl: "https://gw.example" });
  const { account } = merchant(deps);
  if (opts.tokensOff) deps.db.upsertMerchant({ ...deps.db.merchantByEmail("kaja@example.com")!, tokens_off: opts.tokensOff });
  const key = "gf_test_secret";
  deps.db.addApiKey({ hash: keyHash(key), email: "kaja@example.com", label: "shop", last4: "cret", created_at: 0 });
  if (opts.enabled !== false) deps.near.keys[`${account}/${SIGNER_PUB}`] = 10n;
  deps.near.viewTable["gateflow.testnet.get_tokens"] = ["usdc.testnet", "nbtc.testnet"];
  deps.near.viewTable["usdc.testnet.ft_metadata"] = { symbol: "USDC", decimals: 6 };
  deps.near.viewTable["nbtc.testnet.ft_metadata"] = { symbol: "BTC", decimals: 8 };
  const chain: Record<number, any> = {};
  deps.near.viewTable["gateflow.testnet.get_invoice"] = ({ invoice }: any) => chain[invoice] ?? null;
  let next = 40;
  const created = () => (s: any) => {
    const d = decodeSignedDelegate(Buffer.from(s.actions[0].signedDelegate).toString("base64"));
    const a = d.actions[0] as any;
    const args = JSON.parse(new TextDecoder().decode(a.args));
    const id = next++;
    chain[id] = { gateway: args.gateway, token: args.token, amount: args.amount, expires_at_sec: Math.floor(deps.now() / 1000) + args.expires_in_sec, memo: args.memo ?? null, status: "Open", payment: null };
    deps.near.keys[`${account}/${SIGNER_PUB}`] = d.nonce;
    return { hash: `tx${id}`, value: id };
  };
  for (let i = 0; i < 100; i++) deps.near.sendResults.push(created());
  const post = (body: any, k = key) => dispatch(apiRoutes, req("POST", "/api/v1/invoices", body, {}, { authorization: `Bearer ${k}` }), deps);
  const get = (id: number | string, k = key) => dispatch(apiRoutes, req("GET", `/api/v1/invoices/${id}`, undefined, {}, { authorization: `Bearer ${k}` }), deps);
  return { deps, account, chain, post, get };
}

const order = { amount: "10.00", currency: "USDC", order_id: "order_123" };

test("api_auth_missing", async () => {
  const { deps, post } = apiSetup();
  assert.equal((await dispatch(apiRoutes, req("POST", "/api/v1/invoices", order), deps)).status, 401);
  assert.equal((await post(order, "gf_test_wrong")).status, 401);
  assert.equal(deps.near.sent.length, 0);
});

test("api_create_ok", async () => {
  const { deps, account, post } = apiSetup();
  const res = await post(order);
  assert.equal(res.status, 201);
  assert.deepEqual(res.json, { id: 40, url: "https://gw.example/pay/40", status: "open", amount: "10.00", currency: "USDC", order_id: "order_123", expires_at: new Date(Math.floor(deps.now() / 1000) * 1000 + 1_800_000).toISOString() });
  const s = deps.near.sent[0];
  assert.equal(s.receiver, account);
  assert.equal(s.executor, "gateflow.testnet");
  const d = decodeSignedDelegate(Buffer.from((s.actions[0] as any).signedDelegate).toString("base64"));
  assert.equal(d.senderId, account);
  assert.equal(d.receiverId, "gateflow.testnet");
  assert.equal(d.publicKey, SIGNER_PUB);
  assert.equal(d.nonce, 11n);
  const a = d.actions[0] as any;
  assert.equal(a.method, "create_invoice");
  assert.equal(a.deposit, 0n);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(a.args)), { gateway: 0, token: "usdc.testnet", amount: "10000000", expires_in_sec: 1800, memo: "order_123" });
});

test("api_create_validation", async () => {
  const { deps, post } = apiSetup();
  for (const [body, field] of [
    [{ ...order, amount: "0" }, "amount"],
    [{ ...order, amount: "1.1234567" }, "amount"],
    [{ ...order, amount: 10 }, "amount"],
    [{ ...order, currency: "DOGE" }, "currency"],
    [{ ...order, order_id: "x".repeat(141) }, "order_id"],
    [{ ...order, expires_in_sec: 59 }, "expires_in_sec"],
  ] as const) {
    const res = await post(body);
    assert.equal(res.status, 422, JSON.stringify(body));
    assert.equal((res.json as any).field, field);
  }
  assert.equal(deps.near.sent.length, 0);
});

test("api_create_not_enabled", async () => {
  const { deps, post } = apiSetup({ enabled: false });
  const res = await post(order);
  assert.equal(res.status, 409);
  assert.deepEqual(res.json, { error: "API is not enabled" });
  assert.equal(deps.near.sent.length, 0);
});

test("api_create_token_off", async () => {
  const { post } = apiSetup({ tokensOff: ["usdc.testnet"] });
  const res = await post(order);
  assert.equal(res.status, 422);
  assert.equal((res.json as any).field, "currency");
});

test("api_dedupe", async () => {
  const { deps, post } = apiSetup();
  const a = await post(order);
  const b = await post({ ...order, amount: "99.00" });
  assert.equal(b.status, 200);
  assert.equal((b.json as any).id, (a.json as any).id);
  assert.equal(deps.near.sent.length, 1);
});

test("api_dedupe_inflight", async () => {
  const { deps, post } = apiSetup();
  const [a, b] = await Promise.all([post(order), post(order)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
  assert.equal((a.json as any).id, (b.json as any).id);
  assert.equal(deps.near.sent.length, 1);
});

test("api_dedupe_after_expiry", async () => {
  const { deps, post } = apiSetup();
  const a = await post(order);
  deps.clock.ms += 1_800_000;
  const b = await post(order);
  assert.equal(b.status, 201);
  assert.notEqual((b.json as any).id, (a.json as any).id);
});

test("api_create_concurrent", async () => {
  const { deps, post } = apiSetup();
  const [a, b] = await Promise.all([post({ ...order, order_id: "o1" }), post({ ...order, order_id: "o2" })]);
  assert.deepEqual([a.status, b.status], [201, 201]);
  assert.notEqual((a.json as any).id, (b.json as any).id);
  const nonces = deps.near.sent.map((s) => decodeSignedDelegate(Buffer.from((s.actions[0] as any).signedDelegate).toString("base64")).nonce);
  assert.deepEqual(nonces, [11n, 12n]);
});

test("api_create_retries_invalid_nonce_once", async () => {
  const { deps, post } = apiSetup();
  deps.near.sendResults.unshift(() => ({ hash: "", error: '{"InvalidTxError":{"InvalidNonce":{}}}' }));
  assert.equal((await post(order)).status, 201);
  assert.equal(deps.near.sent.length, 2);
});

test("api_rate_limit", async () => {
  const { deps, post } = apiSetup();
  for (let i = 0; i < 60; i++) assert.equal((await post({ ...order, order_id: `o${i}` })).status, 201);
  const res = await post({ ...order, order_id: "o60" });
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers?.["retry-after"]) >= 1);
  assert.equal(deps.near.sent.length, 60);
  deps.clock.ms += 60_001;
  assert.equal((await post({ ...order, order_id: "o61" })).status, 201);
});

test("api_get_other_gateway_404", async () => {
  const { chain, get } = apiSetup();
  chain[7] = { gateway: 5, token: "usdc.testnet", amount: "1", expires_at_sec: 0, memo: null, status: "Open", payment: null };
  assert.equal((await get(7)).status, 404);
  assert.equal((await get(999)).status, 404);
});

test("api_get_paid", async () => {
  const { chain, post, get } = apiSetup();
  const id = ((await post(order)).json as any).id;
  chain[id].status = "Paid";
  const res = await get(id);
  assert.equal(res.status, 200);
  assert.equal((res.json as any).status, "paid");
  assert.equal((res.json as any).order_id, "order_123");
});
