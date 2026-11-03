import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkoutRoutes, destinationAsset, originChain, screenable } from "./checkout.ts";
import { dispatch } from "./main.ts";
import { fakeDeps, req, type TestDeps } from "./testing.ts";

const TOKENS = JSON.parse(readFileSync(new URL("./fixtures/oneclick-tokens.json", import.meta.url), "utf8"));
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const SOL_USDC = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const EVM = ["base", "eth", "arb"];

const call = (deps: TestDeps, method: string, path: string, body?: any) => dispatch(checkoutRoutes, req(method, path, body), deps);

test("usdc_destination", () => assert.equal(destinationAsset(TOKENS, USDC), `nep141:${USDC}`));
test("nbtc_destination", () => assert.equal(destinationAsset(TOKENS, "nbtc.bridge.near"), "nep141:nbtc.bridge.near"));
test("zec_destination", () => assert.equal(destinationAsset(TOKENS, "zec.omft.near"), "1cs_v1:near:nep141:zec.omft.near"));
test("unknown_destination", () => assert.equal(destinationAsset(TOKENS, "wrap.testnet"), undefined));
test("base_is_screenable", () => assert.ok(screenable(originChain(TOKENS, BASE_USDC), EVM)));
test("btc_is_screenable", () => assert.ok(screenable(originChain(TOKENS, "nep141:btc.omft.near"), EVM)));
test("solana_not_screenable", () => assert.ok(!screenable(originChain(TOKENS, SOL_USDC), EVM)));

test("assets_screenable_only", async () => {
  const deps = fakeDeps();
  deps.oneclick.tokenList = TOKENS;
  const res = await call(deps, "GET", "/checkout/assets");
  const chains = (res.json as any[]).map((a) => a.chain).sort();
  assert.deepEqual(chains, ["base", "btc", "zec"]);
  assert.ok((res.json as any[]).some((a) => a.symbol === "BTC"));
});

export function withInvoice(deps: TestDeps, inv: Record<string, unknown> = {}, payment: Record<string, unknown> | null = null) {
  deps.near.viewTable["gateflow.testnet.get_invoice"] = ({ invoice }: any) =>
    invoice === 7 ? { gateway: 0, token: USDC, amount: "10000000", expires_at_sec: deps.now() / 1000 + 3600, memo: null, status: "Open", payment: null, ...inv } : null;
  deps.near.viewTable["gateflow.testnet.get_payment"] = () => payment;
  deps.near.viewTable[`${USDC}.ft_metadata`] = { symbol: "USDC", decimals: 6 };
  deps.db.upsertMerchant({ email: "kaja@example.com", name: "Kaja Coffee", account_id: "kaja.op.testnet", public_key: "ed25519:x", gateway_id: 0, step: "done", tokens_off: [] });
  deps.near.viewTable["gateflow.testnet.get_gateway"] = ({ gateway }: any) =>
    gateway === 0 ? { owner: "kaja.op.testnet", payout_to: "kaja.op.testnet", policy: { max_risk: 50 }, fuel: "0", invoices: 1, payments: 0 } : null;
  deps.near.viewTable[`${USDC}.storage_balance_of`] = () => ({ total: "1250000000000000000000", available: "0" });
  deps.near.viewTable[`${USDC}.storage_balance_bounds`] = { min: "1250000000000000000000", max: "1250000000000000000000" };
}

test("checkout_registers_payout", async () => {
  const deps = fakeDeps();
  withInvoice(deps);
  deps.near.viewTable[`${USDC}.storage_balance_of`] = () => null;
  const res = await call(deps, "GET", "/checkout/invoice?id=7");
  assert.equal(res.status, 200);
  assert.equal(deps.near.sent.length, 1);
  assert.equal(deps.near.sent[0].receiver, USDC);
  assert.deepEqual((deps.near.sent[0].actions[0] as any).functionCall.args, { account_id: "kaja.op.testnet", registration_only: true });
});

test("checkout_registration_failure_502", async () => {
  const deps = fakeDeps();
  withInvoice(deps);
  deps.near.viewTable[`${USDC}.storage_balance_of`] = () => null;
  deps.near.sendResults.push(() => ({ hash: "x", error: "not enough balance" }));
  const res = await call(deps, "GET", "/checkout/invoice?id=7");
  assert.equal(res.status, 502);
  assert.equal((res.json as any).id, undefined);
});

test("checkout_invoice_404", async () => {
  const deps = fakeDeps();
  withInvoice(deps);
  assert.equal((await call(deps, "GET", "/checkout/invoice?id=8")).status, 404);
  assert.equal((await call(deps, "GET", "/checkout/invoice?id=x")).status, 400);
  assert.equal((await call(deps, "GET", "/checkout/invoice")).status, 400);
});

test("checkout_invoice_paying", async () => {
  const deps = fakeDeps();
  withInvoice(deps, { status: "Paying", payment: 4 }, { status: "Pending", refund_to: "bob.near" });
  const res = await call(deps, "GET", "/checkout/invoice?id=7");
  const j = res.json as any;
  assert.equal(j.status, "Paying");
  assert.deepEqual(j.payment, { id: 4, status: "Pending", refundTo: "bob.near" });
  assert.equal(j.merchant, "Kaja Coffee");
  assert.equal(j.symbol, "USDC");
  assert.equal(j.decimals, 6);
  assert.equal(res.headers?.["access-control-allow-origin"], "*");
});

test("checkout_invoice_contract", async () => {
  const deps = fakeDeps();
  withInvoice(deps);
  const res = await call(deps, "GET", "/checkout/invoice?id=7");
  assert.equal(res.status, 200);
  assert.equal((res.json as any).contract, "gateflow.testnet");
});

// ---------- quotes, status, screen ----------

import { quoteRequest } from "./checkout.ts";

const REF = "0123456789abcdef0123456789abcdef";
const DEP = "0x1111111111111111111111111111111111111111";
const body = { invoice: 7, originAsset: BASE_USDC, refundTo: "0x2222222222222222222222222222222222222222", refundOnNear: "bob.near" };

function quoting(deps: TestDeps) {
  withInvoice(deps);
  deps.oneclick.tokenList = TOKENS;
  deps.oneclick.quoteReply = { quote: { depositAddress: DEP, amountIn: "10050000", amountInFormatted: "10.05", deadline: new Date(deps.now() + 1800000).toISOString() } };
}

test("quote_request_shape", () => {
  assert.deepEqual(
    quoteRequest({ invoiceId: 7, amount: "10000000", originAsset: BASE_USDC, destinationAsset: `nep141:${USDC}`, refundTo: "0x22", refundOnNear: "bob.near", ref: REF, recipient: "gateflow.testnet", deadlineMs: Date.UTC(2026, 10, 2, 12, 30), dry: false }),
    {
      dry: false,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 100,
      originAsset: BASE_USDC,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: `nep141:${USDC}`,
      amount: "10000000",
      refundTo: "0x22",
      refundType: "ORIGIN_CHAIN",
      recipient: "gateflow.testnet",
      recipientType: "DESTINATION_CHAIN",
      deadline: "2026-11-02T12:30:00.000Z",
      customRecipientMsg: `{"invoice":7,"ref":"${REF}","refund_to":"bob.near"}`,
    },
  );
});

test("quote_records_row", async () => {
  const deps = fakeDeps();
  quoting(deps);
  const res = await call(deps, "POST", "/checkout/quote", body);
  assert.equal(res.status, 200);
  const j = res.json as any;
  assert.match(j.ref, /^[0-9a-f]{32}$/);
  assert.equal(j.depositAddress, DEP);
  assert.equal(j.amountIn, "10050000");
  const sent = deps.oneclick.quotes[0];
  assert.equal(sent.recipient, "gateflow.testnet");
  assert.equal(sent.destinationAsset, `nep141:${USDC}`);
  assert.equal(sent.customRecipientMsg, `{"invoice":7,"ref":"${j.ref}","refund_to":"bob.near"}`);
  assert.equal(deps.db.quoteByDeposit(DEP)?.ref, j.ref);
});

test("quote_bad_refund_on_near_400", async () => {
  const deps = fakeDeps();
  quoting(deps);
  const res = await call(deps, "POST", "/checkout/quote", { ...body, refundOnNear: "Bob!" });
  assert.deepEqual(res.json, { error: "not a NEAR account id" });
  assert.equal(res.status, 400);
});

test("quote_unknown_invoice_404", async () => {
  const deps = fakeDeps();
  quoting(deps);
  assert.equal((await call(deps, "POST", "/checkout/quote", { ...body, invoice: 8 })).status, 404);
  assert.deepEqual(deps.oneclick.calls, []);
});

test("quote_expired_409", async () => {
  const deps = fakeDeps();
  quoting(deps);
  withInvoice(deps, { expires_at_sec: deps.now() / 1000 - 1 });
  assert.equal((await call(deps, "POST", "/checkout/quote", body)).status, 409);
  withInvoice(deps, { status: "Paid" });
  assert.equal((await call(deps, "POST", "/checkout/quote", body)).status, 409);
  assert.deepEqual(deps.oneclick.quotes, []);
});

test("quote_solana_422", async () => {
  const deps = fakeDeps();
  quoting(deps);
  const res = await call(deps, "POST", "/checkout/quote", { ...body, originAsset: SOL_USDC });
  assert.deepEqual(res, { status: 422, json: { error: "this origin chain can't be screened" }, headers: res.headers });
  assert.deepEqual(deps.oneclick.quotes, []);
});

test("quote_undeliverable_token", async () => {
  const deps = fakeDeps();
  quoting(deps);
  withInvoice(deps, { token: "wrap.testnet" });
  deps.near.viewTable["wrap.testnet.ft_metadata"] = { symbol: "wNEAR", decimals: 24 };
  const res = await call(deps, "POST", "/checkout/quote", body);
  assert.equal(res.status, 502);
  assert.deepEqual(deps.oneclick.quotes, []);
  assert.equal(deps.db.openQuotes(deps.now()).length, 0);
});

test("quote_upstream_502", async () => {
  const deps = fakeDeps();
  quoting(deps);
  deps.oneclick.quoteReply = new Error("1Click 500");
  assert.equal((await call(deps, "POST", "/checkout/quote", body)).status, 502);
  assert.equal(deps.db.openQuotes(deps.now()).length, 0);
});

test("deadline_capped_by_expiry", async () => {
  const deps = fakeDeps();
  quoting(deps);
  withInvoice(deps, { expires_at_sec: deps.now() / 1000 + 600 });
  await call(deps, "POST", "/checkout/quote", body);
  assert.equal(deps.oneclick.quotes[0].deadline, new Date(deps.now() + 600000).toISOString());
});

test("status_includes_screening", async () => {
  const deps = fakeDeps();
  deps.db.insertQuote({ ref: REF, invoice: 7, deposit_address: DEP, deadline_ms: deps.now() });
  deps.oneclick.statuses[DEP] = { status: "SUCCESS" };
  assert.deepEqual((await call(deps, "GET", `/checkout/status?depositAddress=${DEP}`)).json, { status: "SUCCESS", screening: false });
  deps.db.markQuote(REF, { screened: true });
  assert.deepEqual((await call(deps, "GET", `/checkout/status?depositAddress=${DEP}`)).json, { status: "SUCCESS", screening: true });
  assert.equal((await call(deps, "GET", "/checkout/status")).status, 400);
});

function screening(deps: TestDeps, payment: unknown, status = "SUCCESS") {
  deps.near.viewTable["gateflow.testnet.get_payment_by_ref"] = ({ reference }: any) => (reference === REF ? payment : null);
  deps.oneclick.statuses[DEP] = { status };
}

test("screen_unknown_ref_404", async () => {
  const deps = fakeDeps();
  screening(deps, null);
  assert.equal((await call(deps, "POST", "/checkout/screen", { depositAddress: DEP, ref: REF })).status, 404);
  assert.deepEqual(deps.oneclick.calls, []);
});

test("screen_bad_ref_400", async () => {
  const deps = fakeDeps();
  assert.equal((await call(deps, "POST", "/checkout/screen", { depositAddress: DEP, ref: "XYZ" })).status, 400);
});

test("screen_pending_409", async () => {
  const deps = fakeDeps();
  screening(deps, [4, { status: "Pending" }], "PENDING_DEPOSIT");
  const res = await call(deps, "POST", "/checkout/screen", { depositAddress: DEP, ref: REF });
  assert.equal(res.status, 409);
  assert.deepEqual(res.json, { error: "PENDING_DEPOSIT" });
  assert.equal(deps.near.sent.length, 0);
});

test("screen_success_sends_screen_intents", async () => {
  const deps = fakeDeps();
  deps.db.insertQuote({ ref: REF, invoice: 7, deposit_address: DEP, deadline_ms: deps.now() });
  screening(deps, [4, { status: "Pending" }]);
  const res = await call(deps, "POST", "/checkout/screen", { depositAddress: DEP, ref: REF });
  assert.deepEqual(res.json, { payment: 4, txHash: "h1" });
  const fc = (deps.near.sent[0].actions[0] as any).functionCall;
  assert.equal(deps.near.sent[0].receiver, "gateflow.testnet");
  assert.equal(fc.method, "screen_intents");
  assert.deepEqual(fc.args, { payment: 4, deposit_address: DEP });
  assert.equal(fc.gas, 300n * 10n ** 12n);
  assert.equal(deps.db.quoteByRef(REF)?.screened, 1);
  assert.deepEqual(deps.db.screening(4), { tx_hash: "h1", sender: "op.testnet", evidence: null });
});
