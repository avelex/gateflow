import { expect, test } from "vitest";
import { onboardingScreen } from "./logic.ts";

test("onboarding_screen", () => {
  for (const m of ["prf", "stored", null] as const) expect(onboardingScreen("account", m)).toBe("details");
  expect(onboardingScreen("tokens", null)).toBe("resume-key");
  expect(onboardingScreen("tokens", "prf")).toBe("details");
  expect(onboardingScreen("gateway", null)).toBe("resume-key");
  expect(onboardingScreen("gateway", "stored")).toBe("gateway");
  expect(onboardingScreen("done", null)).toBe("done");
});

import { heldByToken, type Invoice, type Payment, searchMatches, settledToday } from "./logic.ts";

const USDC = { symbol: "USDC", decimals: 6 };
const NBTC = { symbol: "nBTC", decimals: 8 };
const at = (d: Date) => Math.floor(d.getTime() / 1000);
const pay = (id: number, amount: string, status: string, opened: Date, extra: Partial<Payment> = {}): Payment => ({
  id, gateway: 0, invoice: id, payer: "alice.near", refund_to: "alice.near", token: "usdc.near", amount, ref: null, deposit_address: null,
  opened_at_sec: at(opened), max_risk: 50, status, tokenMeta: USDC, screening: null, origin: null, ...extra,
});
const inv = (id: number, amount: string, meta = USDC, extra: Partial<Invoice> = {}): Invoice => ({
  id, gateway: 0, token: "t", amount, expires_at_sec: 0, memo: null, status: "Open", payment: null, tokenMeta: meta, ...extra,
});

test("settled_today_totals", () => {
  const now = new Date(2026, 10, 2, 15, 0);
  const today = new Date(2026, 10, 2, 9, 30);
  const yesterday = new Date(2026, 10, 1, 23, 59);
  const ps = [pay(0, "10000000", "Settled", today), pay(1, "5000000", "Settled", today), pay(2, "7000000", "Settled", yesterday), pay(3, "9000000", "Pending", today)];
  expect(settledToday(ps, now)).toEqual([{ symbol: "USDC", amount: "15" }]);
  expect(settledToday([], now)).toEqual([]);
});

test("search_matches", () => {
  const invoices = [inv(1, "1000000", NBTC, { memo: "Catering deposit" }), inv(2, "10000000", NBTC), inv(3, "4000000")];
  const payments = [pay(5, "1000000", "Pending", new Date(), { invoice: 1, tokenMeta: NBTC, payer: "Bob.testnet" })];
  const ids = (q: string) => searchMatches(q, invoices, payments).map((m) => `${m.kind}:${m.id}`);
  expect(ids("0.01")).toEqual(["invoice:1", "payment:5"]);
  expect(ids("#3")).toEqual(["invoice:3"]);
  expect(ids("3")).toContain("invoice:3");
  expect(ids("CATERING")).toEqual(["invoice:1"]);
  expect(ids("bob")).toEqual(["payment:5"]);
  expect(ids("")).toEqual([]);
  expect(ids("  ")).toEqual([]);
});

import { invoiceArgs, invoiceTab } from "./logic.ts";

test("invoice_tab_expired", () => {
  const nowSec = 1_800_000_000;
  expect(invoiceTab(inv(1, "1", USDC, { status: "Open", expires_at_sec: nowSec }), nowSec)).toBe("Expired");
  expect(invoiceTab(inv(1, "1", USDC, { status: "Open", expires_at_sec: nowSec + 1 }), nowSec)).toBe("Open");
  expect(invoiceTab(inv(1, "1", USDC, { status: "Paying", expires_at_sec: nowSec - 100 }), nowSec)).toBe("Paying");
  expect(invoiceTab(inv(1, "1", USDC, { status: "Paid" }), nowSec)).toBe("Paid");
  expect(invoiceTab(inv(1, "1", USDC, { status: "Returned" }), nowSec)).toBe("Returned");
});

test("create_invoice_args", () => {
  const form = { gateway: 3, token: "nbtc.bridge.near", decimals: 8, amount: "0.01", expiresInSec: 3600 as const, memo: "" };
  expect(invoiceArgs(form)).toEqual({ gateway: 3, token: "nbtc.bridge.near", amount: "1000000", expires_in_sec: 3600 });
  expect(invoiceArgs({ ...form, memo: "Table 7" })).toEqual({ gateway: 3, token: "nbtc.bridge.near", amount: "1000000", expires_in_sec: 3600, memo: "Table 7" });
  expect(() => invoiceArgs({ ...form, memo: "a".repeat(141) })).toThrow();
  expect(() => invoiceArgs({ ...form, memo: "€".repeat(47) })).toThrow();
  expect(invoiceArgs({ ...form, memo: "a".repeat(140) }).memo).toHaveLength(140);
  expect(() => invoiceArgs({ ...form, amount: "0.000000001" })).toThrow();
});

import { payerLabel, screeningTab } from "./logic.ts";

test("screening_tabs", () => {
  const d = new Date();
  expect(screeningTab(pay(1, "1", "Pending", d))).toBe("Pending");
  expect(screeningTab(pay(1, "1", "Refunded", d))).toBe("Refunded");
  expect(screeningTab(pay(1, "1", "SettleFailed", d))).toBe("Failed");
  expect(screeningTab(pay(1, "1", "RefundFailed", d))).toBe("Failed");
  expect(screeningTab(pay(1, "1", "Settled", d))).toBeUndefined();
});

test("payer_label", () => {
  const d = new Date();
  expect(payerLabel(pay(1, "1", "Pending", d, { ref: "ab".repeat(16), payer: "intents.near", refund_to: "bob.near" }))).toBe("bob.near");
  expect(payerLabel(pay(1, "1", "Pending", d, { payer: "alice.near", refund_to: "alice.near" }))).toBe("alice.near");
});

import { cardModel, traceLabel } from "./logic.ts";

test("trace_label", () => {
  expect(traceLabel(["invoices", "payments"])).toBe("Used invoices, payments");
  expect(traceLabel(["totals"])).toBe("Used totals");
  expect(traceLabel([])).toBe("");
});

test("card_kind_mapping", () => {
  const invoices = [inv(1, "1000000", NBTC, { expires_at_sec: 4e9 }), inv(2, "10000000", USDC, { status: "Paid", payment: 5 }), inv(3, "1", USDC, { status: "Returned", payment: 6 }), inv(4, "1", USDC, { status: "Paying", payment: 7 })];
  const payments = [pay(5, "10000000", "Settled", new Date()), pay(6, "1", "RefundFailed", new Date()), pay(7, "1", "Pending", new Date())];
  const data = { invoices, payments };
  expect(cardModel({ type: "invoice", invoiceId: 1 }, data)).toEqual({ kind: "invoice", invoice: invoices[0] });
  expect(cardModel({ type: "invoice", invoiceId: 99 }, data)).toEqual({ kind: "loading" });
  expect(cardModel({ type: "confirm", actionId: 4 }, data)).toEqual({ kind: "confirm", actionId: 4 });
  // Status cards: Delivered, Screening, then Released or Returned.
  expect(cardModel({ type: "status", invoiceId: 1 }, data)).toMatchObject({ kind: "status", steps: ["Delivered", "Screening", "Released"], current: 0, label: "Open" });
  const expired = { invoices: [inv(8, "1", USDC, { expires_at_sec: 100 })], payments: [] };
  expect(cardModel({ type: "status", invoiceId: 8 }, expired, 100)).toMatchObject({ current: 0, label: "Expired" });
  expect(cardModel({ type: "status", invoiceId: 4 }, data)).toMatchObject({ steps: ["Delivered", "Screening", "Released"], current: 1, label: "Screening", payment: payments[2] });
  expect(cardModel({ type: "status", invoiceId: 2 }, data)).toMatchObject({ steps: ["Delivered", "Screening", "Released"], current: 3, label: "Released" });
  expect(cardModel({ type: "status", invoiceId: 3 }, data)).toMatchObject({ steps: ["Delivered", "Screening", "Returned"], current: 2, label: "Failed" });
});

test("held_by_token", () => {
  const d = new Date();
  const ps = [
    pay(0, "10000000", "Pending", d),
    pay(1, "5000000", "Pending", d),
    pay(2, "300", "Pending", d, { token: "nbtc.near", tokenMeta: NBTC }),
    pay(3, "1", "RefundFailed", d),
    pay(4, "1", "Settled", d),
    pay(5, "1", "Refunded", d),
    pay(6, "7000000", "SettleFailed", d),
  ];
  expect(heldByToken(ps, "Pending")).toEqual(new Map([["usdc.near", 15000000n], ["nbtc.near", 300n]]));
  expect(heldByToken(ps, "SettleFailed")).toEqual(new Map([["usdc.near", 7000000n]]));
  expect(heldByToken([], "Pending")).toEqual(new Map());
});

import { screeningFields } from "./logic.ts";

const EV = {
  txHash: "4e9W", requestId: 2792, project: "ops.gateflow.near/gateflow", wasmHash: "11a4efa612d4c52e", wasmUrl: null,
  timeMs: 1410, costYocto: "1141000000000000000000", outcome: "approved" as const, jobId: null as number | null,
};
const PROJECT = "ops.gateflow.near/gateflow";
const byLabel = (f: ReturnType<typeof screeningFields>) => Object.fromEntries(f.map((x) => [x.label, x.value]));

test("fields_direct_approved", () => {
  const f = byLabel(screeningFields(pay(3, "1", "Settled", new Date(), { screening: EV }), PROJECT, "mainnet"));
  expect(f).toMatchObject({ Flow: "Direct", "Risk limit": "50", Project: PROJECT, Outcome: "Approved", Attestation: "2792", Transaction: "4e9W" });
  expect(Object.keys(f)).not.toContain("Wasm");
  expect(Object.keys(f)).not.toContain("Run time");
  expect(Object.keys(f)).not.toContain("Cost");
});

test("fields_no_verdict", () => {
  const f = byLabel(screeningFields(pay(3, "1", "Refunded", new Date(), { screening: { ...EV, outcome: "no_verdict" } }), PROJECT, "mainnet"));
  expect(f.Wasm).toBeUndefined();
  expect(f.Outcome).toBe("No verdict within 15 minutes");
  expect(f.Attestation).toBeUndefined();
});

test("fields_unavailable", () => {
  const f = byLabel(screeningFields(pay(3, "1", "Settled", new Date()), PROJECT, "mainnet"));
  expect(f["Screening record"]).toContain("record unavailable");
  expect(f.Project).toBe(PROJECT);
});

test("fields_cross_chain", () => {
  const f = byLabel(screeningFields(pay(3, "1", "Pending", new Date(), { ref: "r1", deposit_address: "0x76fc" }), PROJECT, "mainnet"));
  expect(f).toMatchObject({ Flow: "Cross-chain", "Deposit address": "0x76fc" });
  expect(f["Screening record"]).toBeUndefined();
});

test("fields_request_attestation", () => {
  const f = screeningFields(pay(3, "1", "Settled", new Date(), { screening: { ...EV, requestId: 2796, jobId: 1255332 } }), PROJECT, "mainnet");
  expect(f.find((x) => x.label === "Attestation")).toEqual({ label: "Attestation", value: "2796", href: "https://app.outlayer.ai/attestation/1255332?network=mainnet" });
  const plain = screeningFields(pay(3, "1", "Settled", new Date(), { screening: EV }), PROJECT, "mainnet");
  expect(plain.find((x) => x.label === "Attestation")?.href).toBe("https://app.outlayer.ai/executions");
});

test("payer_ref_without_origin", () => {
  expect(payerLabel(pay(1, "1", "Settled", new Date(), { ref: "ab".repeat(16), payer: "intents.near", refund_to: "bob.near" }))).toBe("bob.near");
});

test("flow_direct_without_ref", () => {
  const flow = (ref: string | null) => screeningFields(pay(1, "1", "Settled", new Date(), { ref }), "p", "mainnet").find((f) => f.label === "Flow")!.value;
  expect(flow(null)).toBe("Direct");
  expect(flow("r1")).toBe("Cross-chain");
});

import { invoiceTime } from "./logic.ts";

const evidence = (closedAtSec: number | null) => ({ txHash: "h", requestId: 1, project: "p", wasmHash: "w", wasmUrl: null, timeMs: 1, costYocto: "1", outcome: "approved" as const, jobId: null, screenedAtSec: null, closedAtSec });

test("closed_at_paid", () => {
  const p = pay(4, "1", "Settled", new Date(), { screening: evidence(1793857841) });
  expect(invoiceTime(inv(4, "1", USDC, { status: "Paid", payment: 4, expires_at_sec: 5 }), p)).toEqual({ label: "Paid", sec: 1793857841 });
  expect(invoiceTime(inv(4, "1", USDC, { status: "Returned", payment: 4, expires_at_sec: 5 }), p)).toEqual({ label: "Returned", sec: 1793857841 });
});

test("closed_at_unknown_falls_back", () => {
  const p = pay(4, "1", "Settled", new Date(), { screening: evidence(null) });
  expect(invoiceTime(inv(4, "1", USDC, { status: "Paid", payment: 4, expires_at_sec: 5 }), p)).toEqual({ label: "Expires", sec: 5 });
  expect(invoiceTime(inv(4, "1", USDC, { status: "Open", expires_at_sec: 5 }))).toEqual({ label: "Expires", sec: 5 });
});

test("payer_origin_base", () => {
  const p = pay(1, "1", "Settled", new Date(), { ref: "r", payer: "intents.near", refund_to: "bob.near", origin: { chain: "base", senders: ["0x12ab34ef56cd"] } });
  expect(payerLabel(p)).toBe("0x12ab…56cd on Base");
});

test("payer_origin_btc_plus", () => {
  const p = pay(1, "1", "Settled", new Date(), { ref: "r", payer: "intents.near", origin: { chain: "btc", senders: ["bc1qaaaaaaaaaaaa", "bc1qb", "bc1qc"] } });
  expect(payerLabel(p)).toMatch(/^bc1qaa…aaaa on Bitcoin \+2$/);
});

test("payer_direct", () => expect(payerLabel(pay(1, "1", "Settled", new Date(), { payer: "alice.near" }))).toBe("alice.near"));

import { payerAddress } from "./logic.ts";

test("payer_address_origin", () => {
  const p = (chain: string, s: string) => pay(1, "1", "Settled", new Date(), { ref: "r", payer: "intents.near", refund_to: "bob.near", origin: { chain, senders: [s, "x"] } });
  expect(payerAddress(p("arb", "0x200fabc7414"), "mainnet")).toEqual({ address: "0x200fabc7414", href: "https://arbiscan.io/address/0x200fabc7414" });
  expect(payerAddress(p("base", "0xb"), "mainnet").href).toBe("https://basescan.org/address/0xb");
  expect(payerAddress(p("eth", "0xe"), "mainnet").href).toBe("https://etherscan.io/address/0xe");
  expect(payerAddress(p("btc", "bc1q"), "mainnet").href).toBe("https://mempool.space/address/bc1q");
  expect(payerAddress(p("zec", "t1"), "mainnet").href).toBe("https://blockchair.com/zcash/address/t1");
  expect(payerAddress(p("sol", "So1"), "mainnet")).toEqual({ address: "So1", href: undefined });
});

test("payer_address_near", () => {
  const ref = pay(1, "1", "Settled", new Date(), { ref: "r", payer: "intents.near", refund_to: "bob.near" });
  expect(payerAddress(ref, "mainnet")).toEqual({ address: "bob.near", href: "https://nearblocks.io/address/bob.near" });
  const direct = pay(1, "1", "Settled", new Date(), { ref: null, payer: "alice.testnet" });
  expect(payerAddress(direct, "testnet")).toEqual({ address: "alice.testnet", href: "https://testnet.nearblocks.io/address/alice.testnet" });
});

import { invoiceSteps } from "./logic.ts";

test("invoice_steps_unpaid", () => {
  const open = inv(6, "1", USDC, { status: "Open", expires_at_sec: 500 });
  expect(invoiceSteps(open, undefined, "mainnet", 100)).toEqual([{ title: "Waiting for payment", detail: "The payment link expires", atSec: 500, done: false }]);
  expect(invoiceSteps(open, undefined, "mainnet", 500)[0].title).toBe("Expired unpaid");
});

test("invoice_steps_cross_chain_settled", () => {
  const p = pay(5, "1", "Settled", new Date(1_000_000), {
    ref: "r", origin: { chain: "arb", senders: ["0x200f"] },
    screening: { ...evidence(1793867361), requestId: 2796, timeMs: 1400, jobId: 9, screenedAtSec: 1793867360 },
  });
  const s = invoiceSteps(inv(6, "1", USDC, { status: "Paid", payment: 5 }), p, "mainnet", 0);
  expect(s.map((x) => x.title)).toEqual(["Deposit detected on Arbitrum", "Held in your contract", "Screened: approved", "Released to you"]);
  expect(s.every((x) => x.done)).toBe(true);
  expect(s[1]).toMatchObject({ detail: "Payment #5 opened", atSec: p.opened_at_sec });
  expect(s[2].detail).toBeUndefined();
  expect(s[2]).toMatchObject({ atSec: 1793867360, link: { label: "Attestation", href: "https://app.outlayer.ai/attestation/9?network=mainnet" } });
  expect(s[3]).toMatchObject({ atSec: 1793867361, link: { label: "Transaction", href: "https://nearblocks.io/txns/h" } });
});

test("invoice_steps_direct_pending", () => {
  const p = pay(5, "1", "Pending", new Date(1_000_000), { ref: null, screening: null });
  const s = invoiceSteps(inv(6, "1", USDC, { status: "Paying", payment: 5 }), p, "testnet", 0);
  expect(s.map((x) => `${x.title}:${x.done}`)).toEqual(["Held in your contract:true", "Screening in enclave:false", "Released to you:false"]);
  expect(s[2].link).toBeUndefined();
});

test("invoice_steps_returned", () => {
  const p = pay(5, "1", "Refunded", new Date(1_000_000), { ref: null, screening: { ...evidence(7), outcome: "rejected" } });
  const s = invoiceSteps(inv(6, "1", USDC, { status: "Returned", payment: 5 }), p, "mainnet", 0);
  expect(s.slice(-2).map((x) => x.title)).toEqual(["Screened: rejected", "Returned to payer"]);
});
