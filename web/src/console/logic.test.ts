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

import { type Invoice, type Payment, searchMatches, settledToday } from "./logic.ts";

const USDC = { symbol: "USDC", decimals: 6 };
const NBTC = { symbol: "nBTC", decimals: 8 };
const at = (d: Date) => Math.floor(d.getTime() / 1000);
const pay = (id: number, amount: string, status: string, opened: Date, extra: Partial<Payment> = {}): Payment => ({
  id, gateway: 0, invoice: id, payer: "alice.near", refund_to: "alice.near", token: "usdc.near", amount, reference: null, deposit_address: null,
  opened_at_sec: at(opened), max_risk: 50, status, tokenMeta: USDC, ...extra,
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
