// Live checks against public services. Skipped unless LIVE=1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { destinationAsset, quoteRequest } from "./checkout.ts";
import { oneClick } from "./main.ts";

const live = process.env.LIVE === "1";
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

test("live_dry_quote", { skip: !live && "set LIVE=1" }, async () => {
  const oc = oneClick(process.env.ONECLICK_URL ?? "https://1click.chaindefuser.com", process.env.ONECLICK_API_KEY);
  const tokens = await oc.tokens();
  const destination = destinationAsset(tokens, USDC);
  assert.equal(destination, `nep141:${USDC}`);
  const body = quoteRequest({
    invoiceId: 0,
    amount: "1000000",
    originAsset: BASE_USDC,
    destinationAsset: destination!,
    refundTo: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    refundOnNear: "wrap.near",
    ref: randomBytes(16).toString("hex"),
    recipient: "wrap.near",
    deadlineMs: Date.now() + 30 * 60 * 1000,
    dry: true,
  });
  const reply = await oc.quote(body);
  assert.ok(BigInt(reply.quote.amountIn) >= 1000000n, JSON.stringify(reply.quote));
  console.log("dry quote amountIn", reply.quote.amountIn, reply.quote.amountInFormatted);
});
