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
  id, gateway: 0, invoice: id, payer: "alice.near", refund_to: "alice.near", token: "usdc.near", amount, reference: null, deposit_address: null,
  opened_at_sec: at(opened), max_risk: 50, status, tokenMeta: USDC, screening: null, ...extra,
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
  expect(payerLabel(pay(1, "1", "Pending", d, { reference: "ab".repeat(16), payer: "intents.near", refund_to: "bob.near" }))).toBe("bob.near");
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
  timeMs: 1410, costYocto: "1141000000000000000000", outcome: "approved" as const,
};
const PROJECT = "ops.gateflow.near/gateflow";
const byLabel = (f: ReturnType<typeof screeningFields>) => Object.fromEntries(f.map((x) => [x.label, x.value]));

test("fields_direct_approved", () => {
  const f = byLabel(screeningFields(pay(3, "1", "Settled", new Date(), { screening: EV }), PROJECT, "mainnet"));
  expect(f).toMatchObject({ Flow: "Direct", "Risk limit": "50", Project: PROJECT, Outcome: "Approved", Request: "2792", Wasm: "11a4efa612d4c52e", "Run time": "1.4 s", Cost: "0.001141 NEAR", Transaction: "4e9W" });
});

test("fields_no_verdict", () => {
  const f = byLabel(screeningFields(pay(3, "1", "Refunded", new Date(), { screening: { ...EV, outcome: "no_verdict" } }), PROJECT, "mainnet"));
  expect(f.Wasm).toBeUndefined();
  expect(f.Outcome).toBe("No verdict within 15 minutes");
});

test("fields_unavailable", () => {
  const f = byLabel(screeningFields(pay(3, "1", "Settled", new Date()), PROJECT, "mainnet"));
  expect(f["Screening record"]).toContain("record unavailable");
  expect(f.Project).toBe(PROJECT);
});

test("fields_cross_chain", () => {
  const f = byLabel(screeningFields(pay(3, "1", "Pending", new Date(), { reference: "r1", deposit_address: "0x76fc" }), PROJECT, "mainnet"));
  expect(f).toMatchObject({ Flow: "Cross-chain", "Deposit address": "0x76fc" });
  expect(f["Screening record"]).toBeUndefined();
});
