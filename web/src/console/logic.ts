// Pure console rules (tested in logic.test.ts) and the delegate round trip.
import { api } from "../api.ts";
import { formatAmount, parseAmount } from "../format.ts";
import { type DelegateParams, type MerchantKey, signDelegate } from "../near/delegate.ts";
import { assertOwner, getPasskeyKey, loadStoredKey } from "../near/key.ts";

export type Step = "account" | "tokens" | "gateway" | "done";
export type Me = { email: string; name: string | null; accountId: string | null; gatewayId: number | null; step: Step };

export const TGAS = 10n ** 12n;

/// Which onboarding card to show for the backend step and the key this browser can reach.
export function onboardingScreen(step: string, mode: "prf" | "stored" | null): "details" | "resume-key" | "gateway" | "done" {
  if (step === "done") return "done";
  if (step === "account") return "details";
  if (!mode) return "resume-key";
  return step === "gateway" ? "gateway" : "details";
}

/// The merchant key for one signed action: one passkey prompt in either mode.
export async function acquireKey(mode: "prf" | "stored" | null): Promise<MerchantKey> {
  if (mode === "stored") {
    const k = await loadStoredKey();
    if (k) return k;
    throw new Error("No merchant key on this device. Restore it with your recovery phrase.");
  }
  return getPasskeyKey();
}

type Params = { nonce: string; maxBlockHeight: string; publicKey: string; senderId: string; receiverId: string };

/// Signs `actions` as the merchant and has the relay submit them.
export async function signAndRelay(key: MerchantKey, actions: DelegateParams["actions"]): Promise<{ txHash: string; value: unknown }> {
  const p = await api<Params>("GET", "/console/delegate-params");
  assertOwner(key, p.publicKey);
  const signedDelegate = await signDelegate(key, {
    senderId: p.senderId,
    receiverId: p.receiverId,
    nonce: BigInt(p.nonce),
    maxBlockHeight: BigInt(p.maxBlockHeight),
    actions,
  });
  return api("POST", "/console/relay", { signedDelegate });
}

export type TokenMeta = { symbol: string; decimals: number };
/// A row of GET /console/invoices.
export type Invoice = {
  id: number;
  gateway: number;
  token: string;
  amount: string;
  expires_at_sec: number;
  memo: string | null;
  status: string;
  payment: number | null;
  tokenMeta: TokenMeta;
};
/// A row of GET /console/payments.
export type Payment = {
  id: number;
  gateway: number;
  invoice: number;
  payer: string;
  refund_to: string;
  token: string;
  amount: string;
  reference: string | null;
  deposit_address: string | null;
  opened_at_sec: number;
  max_risk: number;
  status: string;
  tokenMeta: TokenMeta;
};

export const amountOf = (x: { amount: string; tokenMeta: TokenMeta }) => formatAmount(BigInt(x.amount), x.tokenMeta.decimals);

/// Settled payments opened on `now`'s local calendar day, summed per token (the contract stores no settle time).
export function settledToday(payments: Payment[], now: Date): { symbol: string; amount: string }[] {
  const day = (sec: number) => new Date(sec * 1000).toDateString();
  const sums = new Map<string, { meta: TokenMeta; raw: bigint }>();
  for (const p of payments) {
    if (p.status !== "Settled" || day(p.opened_at_sec) !== now.toDateString()) continue;
    const s = sums.get(p.token) ?? { meta: p.tokenMeta, raw: 0n };
    s.raw += BigInt(p.amount);
    sums.set(p.token, s);
  }
  return [...sums.values()].map((s) => ({ symbol: s.meta.symbol, amount: formatAmount(s.raw, s.meta.decimals) }));
}

/// Invoices and payments matching by id, exact amount, symbol, memo or payer.
export function searchMatches(q: string, invoices: Invoice[], payments: Payment[]): { kind: "invoice" | "payment"; id: number; label: string }[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  const id = t.replace(/^#/, "");
  const hit = (x: { id: number; amount: string; tokenMeta: TokenMeta }, texts: (string | null)[]) =>
    String(x.id) === id || amountOf(x) === t || texts.some((s) => s?.toLowerCase().includes(t));
  return [
    ...invoices
      .filter((i) => hit(i, [i.tokenMeta.symbol, i.memo]))
      .map((i) => ({ kind: "invoice" as const, id: i.id, label: `${amountOf(i)} ${i.tokenMeta.symbol}${i.memo ? ` · ${i.memo}` : ""}` })),
    ...payments
      .filter((p) => hit(p, [p.tokenMeta.symbol, p.payer, p.refund_to]))
      .map((p) => ({ kind: "payment" as const, id: p.id, label: `${payerLabel(p)} · ${amountOf(p)} ${p.tokenMeta.symbol}` })),
  ];
}

/// The payer to show: the NEAR refund account for 1Click deliveries (sent by intents.near), else the sender.
export const payerLabel = (p: Payment) => (p.reference ? p.refund_to : p.payer);

export type InvoiceTab = "Open" | "Paying" | "Paid" | "Returned" | "Expired";

/// The invoice's tab: Expired is an Open invoice at or past its expiry.
export function invoiceTab(inv: Invoice, nowSec: number): InvoiceTab {
  if (inv.status === "Open" && inv.expires_at_sec <= nowSec) return "Expired";
  return inv.status as InvoiceTab;
}

export const EXPIRIES = [
  { value: 3600, label: "1 hour" },
  { value: 86400, label: "24 hours" },
  { value: 604800, label: "7 days" },
] as const;

/// `create_invoice` arguments from the form. Throws on a bad amount or a memo over 140 UTF-8 bytes.
export function invoiceArgs(form: { gateway: number; token: string; decimals: number; amount: string; expiresInSec: 3600 | 86400 | 604800; memo: string }) {
  const amount = parseAmount(form.amount, form.decimals).toString();
  const memo = form.memo.trim();
  if (new TextEncoder().encode(memo).length > 140) throw new Error("memo must be at most 140 bytes");
  return { gateway: form.gateway, token: form.token, amount, expires_in_sec: form.expiresInSec, ...(memo ? { memo } : {}) };
}

/// The Screening tab of a payment; Settled payments have none.
export function screeningTab(p: Payment): "Pending" | "Refunded" | "Failed" | undefined {
  if (p.status === "Pending" || p.status === "Refunded") return p.status;
  if (p.status === "SettleFailed" || p.status === "RefundFailed") return "Failed";
  return undefined;
}
