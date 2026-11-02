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
}

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
