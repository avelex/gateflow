import { expect, test } from "vitest";
import { attestationUrl, type CheckoutInvoice, explorerTx, returnedHash, type Screening, screeningDetail, timeline, unpayable } from "./logic.ts";

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

const EVIDENCE: Screening = {
  txHash: "4e9W", requestId: 2792, project: "ops.gateflow.near/gateflow", wasmHash: "11a4efa612d4c52e", wasmUrl: "https://main.fastfs.io/x.wasm",
  timeMs: 1410, costYocto: "1141000000000000000000", outcome: "approved", jobId: null,
};
const labels = (d: ReturnType<typeof screeningDetail>) => d?.links.map((l) => l.label);

test("detail_approved", () => {
  const d = screeningDetail(EVIDENCE, true, "mainnet")!;
  expect(d.text).toContain("request 2792");
  expect(d.text).toContain("11a4efa6");
  expect(d.text).toContain("1.4 s");
  expect(d.text).toContain("Intel TDX");
  expect(labels(d)).toEqual(["Transaction", "OutLayer executions", "Code"]);
  expect(d.links[0].href).toBe("https://nearblocks.io/txns/4e9W");
});

test("detail_failed", () => {
  const d = screeningDetail({ ...EVIDENCE, outcome: "failed" }, true, "mainnet")!;
  expect(d.text).toContain("returned no verdict");
  expect(d.text).not.toContain("11a4efa6");
  expect(labels(d)).toEqual(["Transaction"]);
});

test("detail_no_verdict", () => {
  const d = screeningDetail({ ...EVIDENCE, outcome: "no_verdict" }, true, "mainnet")!;
  expect(d.text).toContain("within 15 minutes");
  expect(d.text).not.toContain("11a4efa6");
});

test("detail_null_decided", () => {
  const d = screeningDetail(null, true, "mainnet")!;
  expect(d.text).toContain("screening record is unavailable");
  expect(d.links[0].href).toBe("https://app.outlayer.ai/executions");
  expect(screeningDetail(null, false, "mainnet")).toBeUndefined();
});

test("detail_pending_running", () => {
  expect(screeningDetail({ ...EVIDENCE, outcome: "pending", timeMs: null, wasmHash: null }, false, "mainnet")?.text).toBe("Running in OutLayer · request 2792");
});

test("explorer_testnet", () => expect(explorerTx("4e9W", "testnet")).toBe("https://testnet.nearblocks.io/txns/4e9W"));

test("detail_attestation_link", () => {
  const d = screeningDetail({ ...EVIDENCE, jobId: 1255332 }, true, "mainnet")!;
  expect(d.links[1]).toEqual({ label: "TEE attestation", href: "https://app.outlayer.ai/attestation/1255332?network=mainnet" });
  expect(attestationUrl(7, "testnet")).toBe("https://app.outlayer.ai/attestation/7?network=testnet");
});

test("detail_failed_no_attestation", () => {
  const d = screeningDetail({ ...EVIDENCE, outcome: "failed", jobId: 1255332 }, true, "mainnet")!;
  expect(d.links.map((l) => l.label)).toEqual(["Transaction"]);
});

test("timeline_times_paid", () => {
  const times = { depositSeenAtSec: 1793857780, openedAtSec: 1793857812, screenedAtSec: 1793857840, closedAtSec: 1793857841 };
  const t = timeline(inv({ status: "Paid", payment: { id: 1, status: "Settled", refundTo: "bob.near" }, times }), "SUCCESS");
  expect(t.map((s) => s.atSec)).toEqual([1793857780, 1793857812, 1793857840, 1793857841]);
});

test("timeline_time_missing", () => {
  const times = { depositSeenAtSec: null, openedAtSec: 1793857812, screenedAtSec: null, closedAtSec: null };
  const t = timeline(inv({ status: "Paid", payment: { id: 1, status: "Settled", refundTo: "bob.near" }, times }));
  expect(t.map((s) => s.atSec)).toEqual([1793857812, undefined, undefined]);
});

test("timeline_no_time_on_current_step", () => {
  const times = { depositSeenAtSec: null, openedAtSec: 1793857812, screenedAtSec: 1793857840, closedAtSec: null };
  const t = timeline(inv({ status: "Paying", payment: { id: 1, status: "Pending", refundTo: "bob.near" }, times }));
  expect(t.find((s) => s.label === "Screening in enclave")?.atSec).toBeUndefined();
});

import { feeLine } from "./logic.ts";

const fq = (amountIn: string, symbol = "USDC"): SavedQuote => ({ ref: "r", depositAddress: "0x", depositMemo: null, amountIn, amountInFormatted: null, deadline: "", symbol });

test("fee_line_usdc", () => {
  expect(feeLine(fq("1010225"), { amount: "1000000", decimals: 6 }, 6)).toBe("0.010225 USDC of this covers the 1Click fee and slippage buffer.");
});

test("fee_line_mixed_decimals", () => {
  // 1.010225 of an 18-decimal origin token for a 1.0 invoice in a 6-decimal token
  expect(feeLine(fq("1010225000000000000", "USDC"), { amount: "1000000", decimals: 6 }, 18)).toBe("0.010225 USDC of this covers the 1Click fee and slippage buffer.");
  expect(feeLine(fq("101", "BTC"), { amount: "1000000000000", decimals: 12 }, 2)).toBe("0.01 BTC of this covers the 1Click fee and slippage buffer.");
});

test("fee_line_none_when_exact", () => {
  expect(feeLine(fq("1000000"), { amount: "1000000", decimals: 6 }, 6)).toBeUndefined();
  expect(feeLine(fq("999999"), { amount: "1000000", decimals: 6 }, 6)).toBeUndefined();
});

import { chainRows } from "./logic.ts";

const rows = (chains: string[]) => chainRows(chains.map((chain) => ({ chain }))).map((r) => `${r.asset.chain}:${r.nested}`);

test("chain_rows_usdc", () => {
  expect(rows(["base", "arb", "eth"])).toEqual(["eth:false", "base:true", "arb:true"]);
});

test("chain_rows_orphan_l2", () => {
  expect(rows(["base", "arb"])).toEqual(["base:false", "arb:false"]);
  expect(rows(["op", "eth"])).toEqual(["eth:false", "op:false"]);
});

test("chain_rows_eth_first", () => {
  expect(rows(["btc", "base", "eth"])).toEqual(["eth:false", "base:true", "btc:false"]);
});

test("chain_rows_single", () => {
  expect(rows(["btc"])).toEqual(["btc:false"]);
});

test("chain_rows_empty", () => {
  expect(rows([])).toEqual([]);
});
