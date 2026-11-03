import { expect, test } from "vitest";
import { type CheckoutInvoice, returnedHash, timeline, unpayable } from "./logic.ts";

const base: CheckoutInvoice = {
  id: 7, gateway: 0, merchant: "Kaja Coffee", contract: "gateflow.near", token: "nbtc.bridge.near", symbol: "nBTC", decimals: 8,
  amount: "1000000", memo: null, expiresAtSec: 2_000_000_000, status: "Open", payment: null,
};
const inv = (o: Partial<CheckoutInvoice>) => ({ ...base, ...o });
const states = (t: ReturnType<typeof timeline>) => t.map((s) => `${s.label}:${s.state}`);

test("unpayable_states", () => {
  expect(unpayable(inv({ status: "Paid" }), 0)).toBe("paid");
  expect(unpayable(inv({ status: "Returned" }), 0)).toBe("returned");
  expect(unpayable(inv({ status: "Paying" }), 3_000_000_000)).toBeUndefined();
  expect(unpayable(inv({ status: "Open" }), 0)).toBeUndefined();
});

test("unpayable_at_expiry_boundary", () => {
  expect(unpayable(inv({ expiresAtSec: 100 }), 100)).toBe("expired");
  expect(unpayable(inv({ expiresAtSec: 101 }), 100)).toBeUndefined();
});

test("timeline_direct_pending", () => {
  const t = timeline(inv({ status: "Paying", payment: { id: 1, status: "Pending", refundTo: "bob.near" } }));
  expect(states(t)).toEqual(["Delivered to contract:done", "Screening in enclave:current", "Released to merchant:todo"]);
});

test("timeline_cross_chain_detected", () => {
  const t = timeline(inv({}), "PROCESSING");
  expect(states(t)).toEqual(["Deposit detected:done", "Delivered to contract:current", "Screening in enclave:todo", "Released to merchant:todo"]);
  expect(states(timeline(inv({}), "PENDING_DEPOSIT"))[0]).toBe("Deposit detected:current");
});

test("timeline_paid", () => {
  const t = timeline(inv({ status: "Paid", payment: { id: 1, status: "Settled", refundTo: "bob.near" } }), "SUCCESS");
  expect(t.at(-1)).toEqual({ label: "Released to merchant", state: "done" });
  expect(t.every((s) => s.state === "done")).toBe(true);
});

test("timeline_returned", () => {
  const t = timeline(inv({ status: "Returned", payment: { id: 1, status: "Refunded", refundTo: "bob.near" } }));
  expect(t.at(-1)).toEqual({ label: "Returned to you", state: "done", detail: "bob.near" });
});

test("timeline_origin_refund", () => {
  const t = timeline(inv({}), "REFUNDED");
  expect(t[0]).toMatchObject({ label: "Returned on the origin chain", state: "done" });
  expect(t.slice(1).map((s) => s.state)).toEqual(["todo", "todo", "todo"]);
});

import { transferCallArgs } from "./logic.ts";

test("transfer_call_args", () => {
  const a = transferCallArgs(inv({ id: 7, token: "wrap.testnet", contract: "gateflow-dev-v1.testnet", amount: "1000000000000000000000000" }));
  expect(a).toEqual({
    receiverId: "wrap.testnet",
    method: "ft_transfer_call",
    args: { receiver_id: "gateflow-dev-v1.testnet", amount: "1000000000000000000000000", msg: '{"invoice":7}' },
    gas: "300000000000000",
    deposit: "1",
  });
});

import { clearQuote, loadQuote, quoteFormError, type SavedQuote, saveQuote } from "./logic.ts";

test("quote_form_requires_both_refunds", () => {
  const ok = { originAsset: "nep141:btc.omft.near", refundTo: "bc1qxyz", refundOnNear: "bob.near" };
  expect(quoteFormError(ok)).toBeUndefined();
  expect(quoteFormError({ ...ok, originAsset: "" })).toBe("originAsset");
  expect(quoteFormError({ ...ok, refundTo: "" })).toBe("refundTo");
  expect(quoteFormError({ ...ok, refundTo: "   " })).toBe("refundTo");
  expect(quoteFormError({ ...ok, refundOnNear: "Bob.near" })).toBe("refundOnNear");
  expect(quoteFormError({ ...ok, refundOnNear: "" })).toBe("refundOnNear");
});

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
const q: SavedQuote = { ref: "ab".repeat(16), depositAddress: "bc1qdep", depositMemo: null, amountIn: "1004200", amountInFormatted: "0.010042", deadline: "2026-11-02T12:30:00.000Z" };

test("saved_quote_roundtrip", () => {
  const s = new MemStorage() as unknown as Storage;
  saveQuote(7, q, s);
  expect(loadQuote(7, s)).toEqual(q);
  expect(loadQuote(8, s)).toBeUndefined();
  clearQuote(7, s);
  expect(loadQuote(7, s)).toBeUndefined();
});

test("saved_quote_bad_storage", () => {
  const corrupt = new MemStorage();
  corrupt.setItem("gateflow:quote:7", "{not json");
  expect(loadQuote(7, corrupt as unknown as Storage)).toBeUndefined();
  const partial = new MemStorage();
  partial.setItem("gateflow:quote:7", JSON.stringify({ ref: 1 }));
  expect(loadQuote(7, partial as unknown as Storage)).toBeUndefined();
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } } as unknown as Storage;
  expect(loadQuote(7, throwing)).toBeUndefined();
  expect(() => saveQuote(7, q, throwing)).not.toThrow();
  expect(() => clearQuote(7, throwing)).not.toThrow();
});

test("returned_hash_from_redirect", () => {
  expect(returnedHash("?transactionHashes=8Kd,9Zz")).toBe("8Kd");
  expect(returnedHash("?transactionHashes=8Kd")).toBe("8Kd");
});

test("no_hash", () => {
  expect(returnedHash("")).toBeUndefined();
  expect(returnedHash("?errorCode=userRejected")).toBeUndefined();
});
