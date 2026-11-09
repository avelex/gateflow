import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkoutRoutes, destinationAsset, originChain, sameAssets, screenable } from "./checkout.ts";
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
test("solana_screenable", () => assert.ok(screenable(originChain(TOKENS, SOL_USDC), EVM)));

test("assets_screenable_only", async () => {
  const deps = fakeDeps();
  deps.oneclick.tokenList = TOKENS;
  const res = await call(deps, "GET", "/checkout/assets");
  const chains = (res.json as any[]).map((a) => a.chain).sort();
  assert.deepEqual(chains, ["base", "btc", "sol", "zec"]);
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
  assert.equal(deps.db.quoteByDeposit(DEP)?.origin_chain, "base");
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

const TRON_USDT = "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near";

test("quote_tron_422", async () => {
  const deps = fakeDeps();
  quoting(deps);
  deps.oneclick.tokenList = [...TOKENS, { assetId: TRON_USDT, blockchain: "tron", symbol: "USDT", decimals: 6, coingeckoId: "tether" }];
  const res = await call(deps, "POST", "/checkout/quote", { ...body, originAsset: TRON_USDT });
  assert.deepEqual(res, { status: 422, json: { error: "this origin chain can't be screened" }, headers: res.headers });
  assert.deepEqual(deps.oneclick.quotes, []);
});

test("quote_solana_ok", async () => {
  const deps = fakeDeps();
  quoting(deps);
  const res = await call(deps, "POST", "/checkout/quote", { ...body, originAsset: SOL_USDC, refundTo: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" });
  assert.equal(res.status, 200);
  const j = res.json as any;
  assert.equal(j.depositAddress, DEP);
  assert.equal(j.amountIn, "10050000");
  assert.match(j.ref, /^[0-9a-f]{32}$/);
  assert.equal(deps.oneclick.quotes[0].originAsset, SOL_USDC);
  assert.equal(deps.db.quoteByDeposit(DEP)?.origin_chain, "sol");
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
  assert.equal(fc.gas, 160n * 10n ** 12n);
  assert.equal(deps.db.quoteByRef(REF)?.screened, 1);
  assert.deepEqual(deps.db.screening(4), { tx_hash: "h1", sender: "op.testnet", evidence: null });
});

// ---------- screening evidence ----------

const HASH = "4e9WUscwEZJ4V87JKR9VDHctY5otTxXCCte3nY3cYn1o";
const opened = (payment: number) => ({
  receipts_outcome: [
    {
      outcome: {
        executor_id: "gateflow.testnet",
        logs: [`EVENT_JSON:{"standard":"gateflow","version":"1.0.0","event":"payment_opened","data":[{"payment":${payment},"invoice":7,"gateway":0}]}`],
        status: { SuccessValue: "" },
      },
    },
  ],
});
const paid = (deps: TestDeps) => withInvoice(deps, { status: "Paying", payment: 3 }, { status: "Pending", refund_to: "bob.near", payer: "0xabc" });

test("tx_accepted", async () => {
  const deps = fakeDeps();
  paid(deps);
  deps.near.txTable[HASH] = opened(3);
  const res = await call(deps, "POST", "/checkout/tx", { invoice: 7, txHash: HASH });
  assert.deepEqual(res.json, { payment: 3 });
  assert.deepEqual(deps.near.txCalls, [{ hash: HASH, sender: "0xabc" }]);
  assert.deepEqual(deps.db.screening(3), { tx_hash: HASH, sender: "0xabc", evidence: null });
});

test("tx_other_payment_422", async () => {
  const deps = fakeDeps();
  paid(deps);
  deps.near.txTable[HASH] = opened(2);
  assert.equal((await call(deps, "POST", "/checkout/tx", { invoice: 7, txHash: HASH })).status, 422);
  assert.equal(deps.db.screening(3), undefined);
});

test("tx_not_final_404", async () => {
  const deps = fakeDeps();
  paid(deps);
  assert.equal((await call(deps, "POST", "/checkout/tx", { invoice: 7, txHash: HASH })).status, 404);
  assert.equal(deps.db.screening(3), undefined);
});

test("tx_no_payment_404", async () => {
  const deps = fakeDeps();
  withInvoice(deps);
  assert.equal((await call(deps, "POST", "/checkout/tx", { invoice: 7, txHash: HASH })).status, 404);
  assert.deepEqual(deps.near.txCalls, []);
});

test("tx_bad_hash_400", async () => {
  const deps = fakeDeps();
  paid(deps);
  assert.equal((await call(deps, "POST", "/checkout/tx", { invoice: 7, txHash: "0OIl" })).status, 400);
  assert.equal((await call(deps, "POST", "/checkout/tx", { invoice: 7 })).status, 400);
});

test("tx_second_report_keeps_first", async () => {
  const deps = fakeDeps();
  paid(deps);
  const other = "5zMb4xEuGYpqZvcJq6hoYBysYqJbEVNs5SW3DUvRNbAc";
  deps.near.txTable[HASH] = opened(3);
  deps.near.txTable[other] = opened(3);
  await call(deps, "POST", "/checkout/tx", { invoice: 7, txHash: HASH });
  await call(deps, "POST", "/checkout/tx", { invoice: 7, txHash: other });
  assert.equal(deps.db.screening(3)?.tx_hash, HASH);
});

test("enclave_included", async () => {
  const deps = fakeDeps();
  withInvoice(deps);
  deps.near.viewTable["outlayer.near.get_project"] = ({ project_id }: any) => (project_id === "ops.gateflow.near/gateflow" ? { active_version: "11a4ef" } : null);
  const j = (await call(deps, "GET", "/checkout/invoice?id=7")).json as any;
  assert.deepEqual(j.enclave, { project: "ops.gateflow.near/gateflow", activeVersion: "11a4ef" });
  assert.equal(j.screening, null);
});

test("active_version_cached", async () => {
  const deps = fakeDeps();
  withInvoice(deps);
  deps.near.viewTable["outlayer.near.get_project"] = { active_version: "11a4ef" };
  const reads = () => deps.near.views.filter((v) => v.method === "get_project").length;
  await call(deps, "GET", "/checkout/invoice?id=7");
  deps.clock.ms += 5_000;
  await call(deps, "GET", "/checkout/invoice?id=7");
  assert.equal(reads(), 1);
  deps.clock.ms += 61_000;
  await call(deps, "GET", "/checkout/invoice?id=7");
  assert.equal(reads(), 2);
});

test("outlayer_down_null", async () => {
  const deps = fakeDeps();
  withInvoice(deps);
  const res = await call(deps, "GET", "/checkout/invoice?id=7");
  assert.equal(res.status, 200);
  assert.equal((res.json as any).enclave.activeVersion, null);
});

test("screened_invoice_evidence", async () => {
  const deps = fakeDeps();
  withInvoice(deps, { status: "Paid", payment: 3 }, { status: "Settled", refund_to: "bob.near", payer: "0xabc" });
  deps.db.recordScreening(3, HASH, "0xabc");
  deps.near.txTable[HASH] = JSON.parse(readFileSync(new URL("./fixtures/outlayer-tx-approved.json", import.meta.url), "utf8"));
  const s = ((await call(deps, "GET", "/checkout/invoice?id=7")).json as any).screening;
  assert.equal(s.outcome, "approved");
  assert.equal(s.txHash, HASH);
  assert.equal(s.requestId, 2792);
  assert.equal(s.timeMs, 1410);
  assert.equal(s.costYocto, "1141000000000000000000");
});

test("outlayer_down_invoice_ok", async () => {
  const deps = fakeDeps();
  withInvoice(deps, { status: "Paid", payment: 3 }, { status: "Settled", refund_to: "bob.near", payer: "0xabc" });
  deps.db.recordScreening(3, HASH, "0xabc");
  deps.near.txTable[HASH] = JSON.parse(readFileSync(new URL("./fixtures/outlayer-tx-approved.json", import.meta.url), "utf8"));
  deps.outlayer.fail = new Error("down");
  const res = await call(deps, "GET", "/checkout/invoice?id=7");
  assert.equal(res.status, 200);
  assert.equal((res.json as any).screening.jobId, null);
  assert.equal((res.json as any).screening.outcome, "approved");
});

test("checkout_nbtc_symbol", async () => {
  const deps = fakeDeps();
  withInvoice(deps, { token: "nbtc.bridge.near", amount: "1000000" });
  deps.near.viewTable["nbtc.bridge.near.ft_metadata"] = { symbol: "NBTC", decimals: 8 };
  deps.near.viewTable["nbtc.bridge.near.storage_balance_of"] = () => ({ total: "1", available: "0" });
  const res = await call(deps, "GET", "/checkout/invoice?id=7");
  assert.equal(res.status, 200);
  assert.equal((res.json as any).symbol, "BTC");
});

test("checkout_times_paid", async () => {
  const deps = fakeDeps();
  const ref = "ab".repeat(16);
  withInvoice(deps, { status: "Paid", payment: 4 }, { status: "Settled", ref, refund_to: "bob.near", opened_at_sec: 1793857812 });
  deps.db.insertQuote({ ref, invoice: 7, deposit_address: "dep", deadline_ms: deps.now() + 60_000 });
  deps.db.markQuote(ref, { status: "PROCESSING", nowMs: 1793857780_000 });
  deps.db.recordScreening(4, "h", "relay.testnet");
  deps.db.storeEvidence(4, { txHash: "h", requestId: 1, project: "p", wasmHash: "w", wasmUrl: null, timeMs: 1, costYocto: "1", outcome: "approved", jobId: 9, screenedAtSec: 1793857840, closedAtSec: 1793857841 });
  const res = await call(deps, "GET", "/checkout/invoice?id=7");
  assert.deepEqual((res.json as any).times, { depositSeenAtSec: 1793857780, openedAtSec: 1793857812, screenedAtSec: 1793857840, closedAtSec: 1793857841 });
});

test("checkout_times_open_null", async () => {
  const deps = fakeDeps();
  withInvoice(deps);
  const res = await call(deps, "GET", "/checkout/invoice?id=7");
  assert.deepEqual((res.json as any).times, { depositSeenAtSec: null, openedAtSec: null, screenedAtSec: null, closedAtSec: null });
});

// 1Click lists more look-alikes on mainnet than the fixture holds.
const MORE = [
  ...TOKENS,
  { assetId: "nep141:base-0x1c4a.omft.near", blockchain: "base", symbol: "sUSDC", decimals: 6, coingeckoId: "usd-coin" },
  { assetId: "nep141:arb-0xaf88.omft.near", blockchain: "arb", symbol: "USDC", decimals: 6, coingeckoId: "usd-coin" },
  { assetId: "nep141:eth-0xa0b8.omft.near", blockchain: "eth", symbol: "USDC", decimals: 6, coingeckoId: "usd-coin" },
  { assetId: "nep141:eth-0xdac1.omft.near", blockchain: "eth", symbol: "USDT", decimals: 6, coingeckoId: "tether" },
  { assetId: "1cs_v1:btc:native:coin", blockchain: "btc", symbol: "BTC(OMNI)", decimals: 8, coingeckoId: "bitcoin" },
  { assetId: "nep141:base-0xcbb7.omft.near", blockchain: "base", symbol: "cbBTC", decimals: 8, coingeckoId: "coinbase-wrapped-btc" },
  { assetId: "nep141:eth-0x2260.omft.near", blockchain: "eth", symbol: "WBTC", decimals: 8, coingeckoId: "wrapped-bitcoin" },
];

test("assets_usdc_same_asset", () => {
  assert.deepEqual(sameAssets(MORE, USDC, EVM).map((a) => `${a.chain} ${a.symbol}`).sort(), ["arb USDC", "base USDC", "eth USDC", "sol USDC"]);
});

test("assets_btc_native_only", () => {
  assert.deepEqual(sameAssets(MORE, "nbtc.bridge.near", EVM).map((a) => a.assetId), ["nep141:btc.omft.near"]);
});

test("assets_unknown_token_empty", () => assert.deepEqual(sameAssets(MORE, "wrap.testnet", EVM), []));

test("assets_for_invoice", async () => {
  const deps = fakeDeps();
  withInvoice(deps);
  deps.oneclick.tokenList = MORE;
  const res = await call(deps, "GET", "/checkout/assets?invoice=7");
  assert.deepEqual((res.json as any[]).map((a) => a.chain).sort(), ["arb", "base", "eth", "sol"]);
  assert.equal((await call(deps, "GET", "/checkout/assets?invoice=8")).status, 404);
});

test("assets_invalid_invoice_400", async () => {
  const deps = fakeDeps();
  deps.oneclick.tokenList = MORE;
  assert.equal((await call(deps, "GET", "/checkout/assets?invoice=x")).status, 400);
  assert.equal((await call(deps, "GET", "/checkout/assets?invoice=")).status, 400);
});

test("assets_without_invoice_lists_all", async () => {
  const deps = fakeDeps();
  deps.oneclick.tokenList = MORE;
  const res = await call(deps, "GET", "/checkout/assets");
  assert.ok((res.json as any[]).some((a) => a.symbol === "USDT"));
  assert.ok((res.json as any[]).some((a) => a.chain === "sol"));
});

test("quote_other_asset_422", async () => {
  const deps = fakeDeps();
  quoting(deps);
  deps.oneclick.tokenList = MORE;
  const res = await call(deps, "POST", "/checkout/quote", { ...body, originAsset: "nep141:eth-0xdac1.omft.near" });
  assert.deepEqual(res, { status: 422, json: { error: "originAsset is not this invoice's asset" }, headers: res.headers });
  assert.deepEqual(deps.oneclick.quotes, []);
});

test("checkout_invoice_origins", async () => {
  const deps = fakeDeps();
  withInvoice(deps);
  assert.deepEqual(((await call(deps, "GET", "/checkout/invoice?id=7")).json as any).origins, []);
  deps.db.setOrigins(0, ["https://shop.example"]);
  assert.deepEqual(((await call(deps, "GET", "/checkout/invoice?id=7")).json as any).origins, ["https://shop.example"]);
});
