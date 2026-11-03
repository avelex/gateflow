import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "./main.ts";
import { consoleRoutes, SESSION_COOKIE } from "./console.ts";
import { fakeDeps, fakeNear, req, type TestDeps } from "./testing.ts";

const call = (deps: TestDeps, method: string, path: string, body?: any, cookies?: Record<string, string>) =>
  dispatch(consoleRoutes, req(method, path, body, cookies), deps);

export async function signedIn(deps: TestDeps, email = "kaja@example.com") {
  const res = await call(deps, "POST", "/console/session", { email });
  const token = /gateflow_session=([0-9a-f]+)/.exec(res.headers?.["set-cookie"] ?? "")![1];
  return { [SESSION_COOKIE]: token };
}

test("session_sets_cookie_flags", async () => {
  const deps = fakeDeps();
  const res = await call(deps, "POST", "/console/session", { email: " Kaja@Example.com " });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { step: "account" });
  assert.match(res.headers!["set-cookie"], /^gateflow_session=[0-9a-f]{64}; HttpOnly; SameSite=Lax; Path=\/$/);
  const me = await call(deps, "GET", "/console/me", undefined, await signedIn(deps, "KAJA@example.com"));
  assert.equal((me.json as any).email, "kaja@example.com");
});

test("session_secure_on_https", async () => {
  const deps = fakeDeps({ publicUrl: "https://gateflow.example" });
  const res = await call(deps, "POST", "/console/session", { email: "kaja@example.com" });
  assert.match(res.headers!["set-cookie"], /; Secure$/);
});

test("session_rejects_bad_email", async () => {
  const res = await call(fakeDeps(), "POST", "/console/session", { email: "kaja@" });
  assert.equal(res.status, 400);
  assert.equal(res.headers?.["set-cookie"], undefined);
});

test("me_requires_session", async () => {
  const deps = fakeDeps();
  assert.equal((await call(deps, "GET", "/console/me")).status, 401);
  assert.equal((await call(deps, "GET", "/console/me", undefined, { [SESSION_COOKIE]: "deadbeef" })).status, 401);
});

test("logout_deletes_session", async () => {
  const deps = fakeDeps();
  const cookies = await signedIn(deps);
  assert.equal((await call(deps, "GET", "/console/me", undefined, cookies)).status, 200);
  const out = await call(deps, "DELETE", "/console/session", undefined, cookies);
  assert.match(out.headers!["set-cookie"], /Max-Age=0/);
  assert.equal((await call(deps, "GET", "/console/me", undefined, cookies)).status, 401);
});

// ---------- provisioning ----------

import { generateKeyPairSync } from "node:crypto";
import { secretFromSeed, signer } from "./near.ts";
import { randomLabel } from "./console.ts";

export function newKey() {
  const seed = new Uint8Array(generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).subarray(16));
  const secret = secretFromSeed(seed);
  return { secret, publicKey: signer(secret).publicKeyString };
}

export function withTokens(deps: TestDeps, tokens = ["wrap.testnet", "usdc.testnet"]) {
  deps.near.viewTable["gateflow.testnet.get_tokens"] = tokens;
  for (const t of tokens) deps.near.viewTable[`${t}.storage_balance_bounds`] = { min: "1250000000000000000000", max: "1250000000000000000000" };
}

export async function onboarded(deps: TestDeps, name = "Kaja Coffee") {
  withTokens(deps);
  const cookies = await signedIn(deps);
  const key = newKey();
  const res = await call(deps, "POST", "/console/onboard", { name, publicKey: key.publicKey }, cookies);
  return { cookies, key: { ...key, accountId: (res.json as any).accountId as string }, res };
}

test("random_label_alphabet", () => {
  for (let i = 0; i < 200; i++) assert.match(randomLabel(), /^[a-z2-7]{8}$/);
});

test("onboard_account_under_parent", async () => {
  const deps = fakeDeps({ merchantParent: "merchant.op.testnet" });
  const { key } = await onboarded(deps);
  assert.match(key.accountId, /^[a-z2-7]{8}\.merchant\.op\.testnet$/);
  assert.ok(!key.accountId.includes("kaja"));
  assert.equal(deps.near.sent[0].receiver, key.accountId);
});

test("onboard_label_taken_draws_again", async () => {
  const deps = fakeDeps();
  const checked: string[] = [];
  deps.near.accountExists = async (id) => (checked.push(id), checked.length === 1);
  const { key } = await onboarded(deps);
  assert.equal(checked.length, 2);
  assert.notEqual(key.accountId, checked[0]);
  assert.equal(key.accountId, checked[1]);
});

test("onboard_creates_with_creator", async () => {
  const deps = fakeDeps();
  deps.creator = fakeNear();
  const { key } = await onboarded(deps);
  assert.deepEqual(deps.creator.sent.map((s) => s.receiver), [key.accountId]);
  assert.ok("createAccount" in deps.creator.sent[0].actions[0]);
  assert.deepEqual(deps.near.sent.map((s) => s.receiver), ["wrap.testnet", "usdc.testnet"]);
});

test("onboard_account_tx_actions", async () => {
  const deps = fakeDeps();
  const { res, key } = await onboarded(deps);
  assert.deepEqual(res.json, { step: "gateway", accountId: key.accountId });
  const first = deps.near.sent[0];
  assert.equal(first.receiver, key.accountId);
  assert.deepEqual(first.actions.slice(0, 2), [{ createAccount: true }, { transfer: 10n ** 22n }]);
  assert.equal(signer(key.secret).publicKeyString, key.publicKey);
  assert.deepEqual([...(first.actions[2] as any).addFullAccessKey], [...signer(key.secret).publicKey]);
});

test("onboard_registers_every_token", async () => {
  const deps = fakeDeps();
  const { key } = await onboarded(deps);
  const regs = deps.near.sent.slice(1);
  assert.deepEqual(regs.map((s) => s.receiver), ["wrap.testnet", "usdc.testnet"]);
  for (const r of regs) {
    const fc = (r.actions[0] as any).functionCall;
    assert.equal(fc.method, "storage_deposit");
    assert.deepEqual(fc.args, { account_id: key.accountId, registration_only: true });
    assert.equal(fc.deposit, 1250000000000000000000n);
  }
});

test("onboard_ignores_payout_to", async () => {
  const deps = fakeDeps();
  withTokens(deps);
  const cookies = await signedIn(deps);
  const key = newKey();
  const res = await call(deps, "POST", "/console/onboard", { name: "Kaja Coffee", publicKey: key.publicKey, payoutTo: "shop.testnet" }, cookies);
  assert.equal(res.status, 200);
  const accountId = (res.json as any).accountId;
  assert.equal("payoutTo" in (res.json as any), false);
  assert.deepEqual(deps.near.sent.map((s) => s.receiver), [accountId, "wrap.testnet", "usdc.testnet"]);
  for (const s of deps.near.sent.slice(1)) assert.equal((s.actions[0] as any).functionCall.args.account_id, accountId);
});

test("onboard_twice_resumes", async () => {
  const deps = fakeDeps();
  withTokens(deps);
  const cookies = await signedIn(deps);
  const key = newKey();
  deps.near.sendResults.push(() => undefined, () => ({ hash: "x", error: "boom" }));
  const first = await call(deps, "POST", "/console/onboard", { name: "Kaja Coffee", publicKey: key.publicKey }, cookies);
  assert.equal(first.status, 502);
  assert.equal(deps.db.merchantByEmail("kaja@example.com")?.step, "tokens");
  const again = await call(deps, "POST", "/console/onboard", { name: "Kaja Coffee", publicKey: key.publicKey }, cookies);
  assert.equal((again.json as any).step, "gateway");
  assert.equal(deps.near.sent.filter((s) => "createAccount" in s.actions[0]).length, 1);
});

test("onboard_key_mismatch_409", async () => {
  const deps = fakeDeps();
  const { cookies } = await onboarded(deps);
  const other = await call(deps, "POST", "/console/onboard", { name: "Kaja Coffee", publicKey: newKey().publicKey }, cookies);
  assert.equal(other.status, 409);
});

test("merchant_cap_enforced", async () => {
  const deps = fakeDeps({ maxMerchants: 1 });
  await onboarded(deps);
  const cookies = await signedIn(deps, "other@example.com");
  const res = await call(deps, "POST", "/console/onboard", { name: "Other", publicKey: newKey().publicKey }, cookies);
  assert.equal(res.status, 403);
});

test("onboard_rejects_bad_input", async () => {
  const deps = fakeDeps();
  const cookies = await signedIn(deps);
  assert.equal((await call(deps, "POST", "/console/onboard", { name: "", publicKey: newKey().publicKey }, cookies)).status, 400);
  assert.equal((await call(deps, "POST", "/console/onboard", { name: "Kaja", publicKey: "ed25519:abc" }, cookies)).status, 400);
});

test("onboard_concurrent_single_account", async () => {
  const deps = fakeDeps();
  withTokens(deps);
  const cookies = await signedIn(deps);
  const key = newKey();
  const body = { name: "Kaja Coffee", publicKey: key.publicKey };
  const [a, b] = await Promise.all([call(deps, "POST", "/console/onboard", body, cookies), call(deps, "POST", "/console/onboard", body, cookies)]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(deps.near.sent.filter((s) => "createAccount" in s.actions[0]).length, 1);
});

// ---------- delegate relaying ----------

import { signDelegate } from "./delegate.ts";
import { type Action } from "./near.ts";

const TGAS = 10n ** 12n;

function delegate(key: { secret: string; accountId: string }, actions: Action[], sender = key.accountId) {
  return signDelegate({ senderId: sender, receiverId: "gateflow.testnet", actions, nonce: 2n, maxBlockHeight: 1120n, publicKey: signer(key.secret).publicKey }, key.secret);
}

const createGateway = (payout_to: string): Action => ({ functionCall: { method: "create_gateway", args: { payout_to, policy: { max_risk: 50 } }, gas: 30n * TGAS, deposit: 0n } });
const createInvoice: Action = { functionCall: { method: "create_invoice", args: { gateway: 0, token: "wrap.testnet", amount: "1", expires_in_sec: 3600 }, gas: 30n * TGAS, deposit: 0n } };

test("delegate_params_nonce_plus_one", async () => {
  const deps = fakeDeps();
  const { cookies, key } = await onboarded(deps);
  deps.near.keys[`${key.accountId}/${key.publicKey}`] = 1n;
  const res = await call(deps, "GET", "/console/delegate-params", undefined, cookies);
  assert.deepEqual(res.json, { nonce: "2", maxBlockHeight: "1120", publicKey: key.publicKey, senderId: key.accountId, receiverId: "gateflow.testnet" });
});

test("relay_refused_403_sends_nothing", async () => {
  const deps = fakeDeps();
  const { cookies, key } = await onboarded(deps);
  const before = deps.near.sent.length;
  const res = await call(deps, "POST", "/console/relay", { signedDelegate: delegate(key, [{ transfer: 1n }]) }, cookies);
  assert.equal(res.status, 403);
  const other = await call(deps, "POST", "/console/relay", { signedDelegate: delegate(key, [createInvoice], "mallory.op.testnet") }, cookies);
  assert.equal(other.status, 403);
  assert.equal((await call(deps, "POST", "/console/relay", { signedDelegate: "!!" }, cookies)).status, 400);
  assert.equal(deps.near.sent.length, before);
});

test("relay_invoice_returns_id", async () => {
  const deps = fakeDeps();
  const { cookies, key } = await onboarded(deps);
  deps.near.sendResults.push(() => ({ hash: "tx1", value: 3 }));
  const res = await call(deps, "POST", "/console/relay", { signedDelegate: delegate(key, [createInvoice]) }, cookies);
  assert.deepEqual(res.json, { txHash: "tx1", value: 3 });
  const last = deps.near.sent.at(-1)!;
  assert.equal(last.receiver, key.accountId);
  assert.equal(last.executor, "gateflow.testnet");
  assert.ok("signedDelegate" in last.actions[0]);
});

test("relay_panic_422", async () => {
  const deps = fakeDeps();
  const { cookies, key } = await onboarded(deps);
  deps.near.sendResults.push(() => ({ hash: "tx1", error: "invalid expiry" }));
  const res = await call(deps, "POST", "/console/relay", { signedDelegate: delegate(key, [createInvoice]) }, cookies);
  assert.deepEqual(res, { status: 422, json: { error: "invalid expiry" } });
});

test("create_gateway_sets_gateway_and_funds", async () => {
  const deps = fakeDeps();
  const { cookies, key } = await onboarded(deps);
  deps.near.sendResults.push(() => ({ hash: "tx1", value: 0 }));
  const res = await call(deps, "POST", "/console/relay", { signedDelegate: delegate(key, [createGateway(key.accountId)]) }, cookies);
  assert.equal(res.status, 200);
  const m = deps.db.merchantByEmail("kaja@example.com")!;
  assert.equal(m.gateway_id, 0);
  assert.equal(m.step, "done");
  const fundTx = deps.near.sent.at(-1)!;
  assert.equal(fundTx.receiver, "gateflow.testnet");
  assert.deepEqual((fundTx.actions[0] as any).functionCall.args, { gateway: 0 });
  assert.equal((fundTx.actions[0] as any).functionCall.deposit, deps.cfg.fuelTarget);
  const again = await call(deps, "POST", "/console/relay", { signedDelegate: delegate(key, [createGateway(key.accountId)]) }, cookies);
  assert.equal(again.status, 409);
});

test("create_gateway_failure_keeps_step", async () => {
  const deps = fakeDeps();
  const { cookies, key } = await onboarded(deps);
  deps.near.sendResults.push(() => ({ hash: "tx1", error: "risk cap too high" }));
  const sentBefore = deps.near.sent.length;
  const res = await call(deps, "POST", "/console/relay", { signedDelegate: delegate(key, [createGateway(key.accountId)]) }, cookies);
  assert.equal(res.status, 422);
  assert.equal(deps.db.merchantByEmail("kaja@example.com")?.step, "gateway");
  assert.equal(deps.near.sent.length, sentBefore + 1);
});

// ---------- console data ----------

import { needsTopUp } from "./console.ts";

async function withGateway(deps: TestDeps, g: Partial<{ fuel: string; invoices: number; payments: number }> = {}) {
  const { cookies } = await onboarded(deps);
  const m = deps.db.merchantByEmail("kaja@example.com")!;
  deps.db.upsertMerchant({ ...m, gateway_id: 0, step: "done" });
  deps.near.viewTable["gateflow.testnet.get_gateway"] = {
    owner: m.account_id,
    payout_to: m.account_id,
    policy: { max_risk: 50 },
    fuel: "100000000000000000000000",
    invoices: 0,
    payments: 0,
    ...g,
  };
  for (const t of ["wrap.testnet", "usdc.testnet"]) deps.near.viewTable[`${t}.ft_metadata`] = { symbol: t.split(".")[0].toUpperCase(), decimals: 24 };
  deps.near.sent.length = 0;
  return cookies;
}

test("needs_top_up", () => {
  assert.equal(needsTopUp(19n, 10n), true);
  assert.equal(needsTopUp(20n, 10n), false);
});

test("gateway_tops_up_before_return", async () => {
  const deps = fakeDeps();
  const cookies = await withGateway(deps, { fuel: "15000000000000000000000" });
  const res = await call(deps, "GET", "/console/gateway", undefined, cookies);
  assert.equal((res.json as any).fuel, "100000000000000000000000");
  assert.equal((res.json as any).fuelReady, true);
  const fc = (deps.near.sent[0].actions[0] as any).functionCall;
  assert.equal(fc.method, "fund");
  assert.equal(fc.deposit, 85000000000000000000000n);
  await call(deps, "GET", "/console/gateway", undefined, cookies);
  assert.equal(deps.near.sent.length, 2);
});

test("gateway_full_no_top_up", async () => {
  const deps = fakeDeps();
  const cookies = await withGateway(deps);
  const res = await call(deps, "GET", "/console/gateway", undefined, cookies);
  assert.equal(deps.near.sent.length, 0);
  assert.equal((res.json as any).outlayerProject, "ops.gateflow.near/gateflow");
});

test("invoices_newest_first_paged", async () => {
  const deps = fakeDeps();
  const cookies = await withGateway(deps, { invoices: 150 });
  deps.near.viewTable["gateflow.testnet.get_invoices"] = ({ from_index, limit }: any) =>
    Array.from({ length: limit }, (_, i) => [from_index + i, { token: "wrap.testnet", amount: "1", status: "Open" }]);
  const res = await call(deps, "GET", "/console/invoices", undefined, cookies);
  const ids = (res.json as any[]).map((x) => x.id);
  assert.equal(ids.length, 150);
  assert.equal(ids[0], 149);
  assert.equal(ids.at(-1), 0);
  assert.equal(deps.near.views.filter((v) => v.method === "get_invoices").length, 2);
  assert.deepEqual((res.json as any[])[0].tokenMeta, { symbol: "WRAP", decimals: 24 });
});

test("payments_carry_screening", async () => {
  const deps = fakeDeps();
  const cookies = await withGateway(deps, { payments: 2 });
  deps.near.viewTable["gateflow.testnet.get_payments"] = ({ from_index, limit }: any) =>
    Array.from({ length: limit }, (_, i) => [from_index + i, { token: "wrap.testnet", amount: "1", status: "Settled" }]);
  const stored = { txHash: "h", requestId: 2792, project: "p", wasmHash: "w", wasmUrl: null, timeMs: 1, costYocto: "1", outcome: "approved", jobId: 1255043 };
  deps.db.recordScreening(1, "h", "0xabc");
  deps.db.storeEvidence(1, stored);
  const rows = (await call(deps, "GET", "/console/payments", undefined, cookies)).json as any[];
  assert.deepEqual(rows.find((p) => p.id === 1).screening, stored);
  assert.equal(rows.find((p) => p.id === 0).screening, null);
});

test("tokens_respect_preferences", async () => {
  const deps = fakeDeps();
  const cookies = await withGateway(deps);
  assert.equal((await call(deps, "PUT", "/console/preferences", { tokensOff: ["usdc.testnet"] }, cookies)).status, 200);
  const res = await call(deps, "GET", "/console/tokens", undefined, cookies);
  assert.deepEqual((res.json as any[]).map((t) => [t.token, t.enabled]), [["wrap.testnet", true], ["usdc.testnet", false]]);
});

test("preferences_reject_unknown_token", async () => {
  const deps = fakeDeps();
  const cookies = await withGateway(deps);
  assert.equal((await call(deps, "PUT", "/console/preferences", { tokensOff: ["evil.testnet"] }, cookies)).status, 400);
  assert.equal((await call(deps, "PUT", "/console/preferences", { tokensOff: "wrap.testnet" }, cookies)).status, 400);
});

test("retry_only_failed_own_payment", async () => {
  const deps = fakeDeps();
  const cookies = await withGateway(deps);
  const payments: Record<number, any> = { 1: { gateway: 0, status: "RefundFailed" }, 2: { gateway: 9, status: "RefundFailed" }, 3: { gateway: 0, status: "Settled" } };
  deps.near.viewTable["gateflow.testnet.get_payment"] = ({ payment }: any) => payments[payment] ?? null;
  assert.equal((await call(deps, "POST", "/console/retry", { payment: 2 }, cookies)).status, 403);
  assert.equal((await call(deps, "POST", "/console/retry", { payment: 3 }, cookies)).status, 403);
  assert.equal((await call(deps, "POST", "/console/retry", { payment: 7 }, cookies)).status, 403);
  assert.equal(deps.near.sent.length, 0);
  const ok = await call(deps, "POST", "/console/retry", { payment: 1 }, cookies);
  assert.equal(ok.status, 200);
  assert.deepEqual((deps.near.sent[0].actions[0] as any).functionCall.args, { payment: 1 });
});

test("metadata_cached", async () => {
  const deps = fakeDeps();
  const cookies = await withGateway(deps);
  await call(deps, "GET", "/console/tokens", undefined, cookies);
  await call(deps, "GET", "/console/tokens", undefined, cookies);
  assert.equal(deps.near.views.filter((v) => v.method === "ft_metadata").length, 2);
});

test("console_data_requires_gateway", async () => {
  const deps = fakeDeps();
  const { cookies } = await onboarded(deps);
  assert.equal((await call(deps, "GET", "/console/gateway", undefined, cookies)).status, 409);
});

function withBalances(deps: TestDeps) {
  deps.near.viewTable["usdc.testnet.ft_metadata"] = { symbol: "USDC", decimals: 6 };
  deps.near.viewTable["usdc.testnet.ft_balance_of"] = "40000000";
  deps.near.viewTable["wrap.testnet.ft_balance_of"] = "0";
}

test("balances_need_session", async () => {
  assert.equal((await call(fakeDeps(), "GET", "/console/balances")).status, 401);
});

test("balances_need_gateway", async () => {
  const deps = fakeDeps();
  const { cookies } = await onboarded(deps);
  assert.equal((await call(deps, "GET", "/console/balances", undefined, cookies)).status, 409);
});

test("balances_of_payout", async () => {
  const deps = fakeDeps();
  const cookies = await withGateway(deps);
  withBalances(deps);
  const res = await call(deps, "GET", "/console/balances", undefined, cookies);
  assert.deepEqual(res.json, [
    { token: "wrap.testnet", symbol: "WRAP", decimals: 24, balance: "0" },
    { token: "usdc.testnet", symbol: "USDC", decimals: 6, balance: "40000000" },
  ]);
  const reads = deps.near.views.filter((v) => v.method === "ft_balance_of");
  const id = deps.db.merchantByEmail("kaja@example.com")!.account_id;
  assert.deepEqual(reads.map((v) => v.args), [{ account_id: id }, { account_id: id }]);
});

test("balances_include_switched_off", async () => {
  const deps = fakeDeps();
  const cookies = await withGateway(deps);
  withBalances(deps);
  await call(deps, "PUT", "/console/preferences", { tokensOff: ["usdc.testnet"] }, cookies);
  const res = await call(deps, "GET", "/console/balances", undefined, cookies);
  assert.deepEqual((res.json as any[]).map((b) => b.token), ["wrap.testnet", "usdc.testnet"]);
});

// ---------- payout registration sync ----------

import { ensureRegistered, syncRegistrations } from "./console.ts";

/// Fakes `storage_balance_of` on `tokens`: registered when listed in `already` or sent a successful `storage_deposit`.
function withStorage(deps: TestDeps, tokens: string[], already: string[] = []) {
  withTokens(deps, tokens);
  for (const t of tokens)
    deps.near.viewTable[`${t}.storage_balance_of`] = ({ account_id }: any) =>
      already.includes(`${t}:${account_id}`) || deposits(deps).includes(`${t}:${account_id}`) ? { total: "1250000000000000000000", available: "0" } : null;
}

const deposits = (deps: TestDeps) =>
  deps.near.sent.filter((s) => (s.actions[0] as any).functionCall?.method === "storage_deposit" && !(s as any).failed).map((s) => `${s.receiver}:${(s.actions[0] as any).functionCall.args.account_id}`);

function twoMerchants(deps: TestDeps) {
  for (const [i, who] of ["a", "b"].entries())
    deps.db.upsertMerchant({ email: `${who}@example.com`, name: who, account_id: `${who}.op.testnet`, public_key: "ed25519:x", gateway_id: i, step: "done", tokens_off: [] });
  deps.db.upsertMerchant({ email: "c@example.com", name: "c", account_id: "c.op.testnet", public_key: "ed25519:x", gateway_id: null, step: "gateway", tokens_off: [] });
  deps.near.viewTable["gateflow.testnet.get_gateway"] = ({ gateway }: any) => ({ owner: "x", payout_to: gateway === 0 ? "a.op.testnet" : "b.op.testnet", policy: { max_risk: 50 }, fuel: "0", invoices: 0, payments: 0 });
}

test("ensure_registered_skips_registered", async () => {
  const deps = fakeDeps();
  withStorage(deps, ["wrap.testnet"], ["wrap.testnet:kaja.testnet"]);
  assert.equal(await ensureRegistered(deps, "kaja.testnet", "wrap.testnet"), false);
  assert.equal(deps.near.sent.length, 0);
});

test("ensure_registered_registers_missing", async () => {
  const deps = fakeDeps();
  withStorage(deps, ["wrap.testnet"]);
  assert.equal(await ensureRegistered(deps, "kaja.testnet", "wrap.testnet"), true);
  assert.equal(deps.near.sent.length, 1);
  const fc = (deps.near.sent[0].actions[0] as any).functionCall;
  assert.equal(deps.near.sent[0].receiver, "wrap.testnet");
  assert.deepEqual(fc.args, { account_id: "kaja.testnet", registration_only: true });
  assert.equal(fc.deposit, 1250000000000000000000n);
  assert.equal(fc.gas, 30n * TGAS);
});

test("ensure_registered_concurrent_once", async () => {
  const deps = fakeDeps();
  withStorage(deps, ["wrap.testnet"]);
  const r = await Promise.all([ensureRegistered(deps, "kaja.testnet", "wrap.testnet"), ensureRegistered(deps, "kaja.testnet", "wrap.testnet")]);
  assert.deepEqual(r.sort(), [false, true]);
  assert.equal(deps.near.sent.length, 1);
});

test("sync_registers_all_payouts", async () => {
  const deps = fakeDeps();
  twoMerchants(deps);
  withStorage(deps, ["wrap.testnet", "usdc.testnet"], ["wrap.testnet:a.op.testnet"]);
  assert.equal(await syncRegistrations(deps), 3);
  assert.deepEqual(deposits(deps).sort(), ["usdc.testnet:a.op.testnet", "usdc.testnet:b.op.testnet", "wrap.testnet:b.op.testnet"]);
  assert.equal(await syncRegistrations(deps), 0);
});

test("sync_continues_after_failure", async () => {
  const deps = fakeDeps();
  twoMerchants(deps);
  withStorage(deps, ["wrap.testnet", "usdc.testnet"]);
  deps.near.sendResults.push((s) => (((s as any).failed = true), { hash: "x", error: "boom" }));
  assert.equal(await syncRegistrations(deps), 3);
  assert.equal(deps.near.sent.length, 4);
  assert.equal(deposits(deps).length, 3);
});
