// Pure console rules (tested in logic.test.ts) and the delegate round trip.
import { api } from "../api.ts";
import { attestationUrl, explorerTx, OUTLAYER_EXECUTIONS, type Screening } from "../checkout/logic.ts";
import { chainName } from "../assets.ts";
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

/// Signs `actions` as the merchant and has the relay submit them. `actionId` binds them to a confirmed assistant action.
export async function signAndRelay(key: MerchantKey, actions: DelegateParams["actions"], actionId?: number): Promise<{ txHash: string; value: unknown }> {
  const p = await api<Params>("GET", "/console/delegate-params");
  assertOwner(key, p.publicKey);
  const signedDelegate = await signDelegate(key, {
    senderId: p.senderId,
    receiverId: p.receiverId,
    nonce: BigInt(p.nonce),
    maxBlockHeight: BigInt(p.maxBlockHeight),
    actions,
  });
  return api("POST", "/console/relay", actionId === undefined ? { signedDelegate } : { signedDelegate, actionId });
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
  /// The 1Click reference; the contract serializes it as `ref`.
  ref: string | null;
  deposit_address: string | null;
  opened_at_sec: number;
  max_risk: number;
  status: string;
  tokenMeta: TokenMeta;
  screening: Screening | null;
  /// Who sent a cross-chain deposit on its origin chain; null when unknown or for a direct payment.
  origin: { chain: string; senders: string[] } | null;
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

/// Raw amounts of payments in `status`, summed per token contract.
export function heldByToken(payments: Payment[], status: "Pending" | "SettleFailed"): Map<string, bigint> {
  const sums = new Map<string, bigint>();
  for (const p of payments) if (p.status === status) sums.set(p.token, (sums.get(p.token) ?? 0n) + BigInt(p.amount));
  return sums;
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

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/// The payer to show: the origin sender of a cross-chain deposit, else the NEAR refund account of a 1Click delivery
/// (sent by intents.near), else the sender.
export function payerLabel(p: Payment): string {
  const o = p.origin;
  if (o?.senders.length) return `${short(o.senders[0])} on ${chainName(o.chain)}${o.senders.length > 1 ? ` +${o.senders.length - 1}` : ""}`;
  return p.ref ? p.refund_to : p.payer;
}

const ADDRESS_EXPLORER: Record<string, string> = {
  eth: "https://etherscan.io/address/",
  base: "https://basescan.org/address/",
  arb: "https://arbiscan.io/address/",
  btc: "https://mempool.space/address/",
  zec: "https://blockchair.com/zcash/address/",
};

/// The payer as one address with its explorer link: the first origin sender, else the account `payerLabel` names.
export function payerAddress(p: Payment, network: string): { address: string; href?: string } {
  const o = p.origin;
  if (o?.senders.length) return { address: o.senders[0], href: ADDRESS_EXPLORER[o.chain] && ADDRESS_EXPLORER[o.chain] + o.senders[0] };
  const account = p.ref ? p.refund_to : p.payer;
  return { address: account, href: `https://${network === "testnet" ? "testnet." : ""}nearblocks.io/address/${account}` };
}

/// The time to show for an invoice: its close time once Paid or Returned and known, else its expiry.
export function invoiceTime(inv: Invoice, payment?: Payment): { label: "Paid" | "Returned" | "Expires"; sec: number } {
  const closed = payment?.screening?.closedAtSec;
  if ((inv.status === "Paid" || inv.status === "Returned") && typeof closed === "number") return { label: inv.status, sec: closed };
  return { label: "Expires", sec: inv.expires_at_sec };
}

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

// ---------- assistant ----------

export type Card = { type: "invoice"; invoiceId: number } | { type: "status"; invoiceId: number } | { type: "confirm"; actionId: number };
/// A message of GET /console/thread and POST /console/chat.
export type ChatMsg = { id: number; role: "user" | "assistant"; text: string; trace: string[]; cards: Card[]; created_at: number };
export type Thread = { id: number; title: string; created_at: number };
/// A row of GET /console/action.
export type ChatAction = { id: number; kind: "create_invoice" | "set_policy" | "retry"; params: any; summary: string; status: "pending" | "done" | "dismissed" | "failed"; result: any };

/// The design's trace line: "Used invoices, payments", or nothing when no tool ran.
export const traceLabel = (trace: string[]) => (trace.length ? `Used ${trace.join(", ")}` : "");

export type CardModel =
  | { kind: "loading" }
  | { kind: "invoice"; invoice: Invoice }
  | { kind: "confirm"; actionId: number }
  | { kind: "status"; invoice: Invoice; payment?: Payment; steps: string[]; current: number; label: string };

/// What a chat card shows, from the console's live invoices and payments. Unknown ids load on the next poll.
export function cardModel(card: Card, data: { invoices: Invoice[]; payments: Payment[] }, nowSec = Math.floor(Date.now() / 1000)): CardModel {
  if (card.type === "confirm") return { kind: "confirm", actionId: card.actionId };
  const invoice = data.invoices.find((i) => i.id === card.invoiceId);
  if (!invoice) return { kind: "loading" };
  if (card.type === "invoice") return { kind: "invoice", invoice };
  const payment = invoice.payment === null ? undefined : data.payments.find((p) => p.id === invoice.payment);
  const returned = payment?.status === "Refunded" || payment?.status === "RefundFailed";
  const steps = ["Delivered", "Screening", returned ? "Returned" : "Released"];
  const s = payment?.status;
  const [current, label] =
    !payment ? [0, invoiceTab(invoice, nowSec)] :
    s === "Pending" ? [1, "Screening"] :
    s === "Settled" ? [3, "Released"] :
    s === "Refunded" ? [3, "Returned"] :
    [2, "Failed"];
  return { kind: "status", invoice, payment, steps, current, label };
}

let pendingAsk: string | undefined;

/// Opens a new chat whose first message is `text` (Home, hint chips, Search, Invoices).
export function ask(text: string, navigate: (path: string) => void): void {
  pendingAsk = text.trim();
  if (pendingAsk) navigate("/chat");
}

/// The text queued by `ask`, once.
export function takePendingAsk(): string | undefined {
  const t = pendingAsk;
  pendingAsk = undefined;
  return t;
}

export type Field = { label: string; value: string; href?: string };

const OUTCOME = { pending: "Screening", approved: "Approved", rejected: "Rejected" } as const;

/// The Screening block of an invoice's Details (merchant-console: Invoice screening details).
/// `failed` and `no_verdict` never show a wasm hash as the screening code.
export function screeningFields(p: Payment, project: string, network: string): Field[] {
  const s = p.screening;
  const f: Field[] = [
    { label: "Flow", value: p.ref === null ? "Direct" : "Cross-chain" },
    { label: "Risk limit", value: String(p.max_risk) },
    ...(p.deposit_address ? [{ label: "Deposit address", value: p.deposit_address }] : []),
    { label: "Project", value: s?.project ?? project },
  ];
  if (!s) return p.status === "Pending" ? f : [...f, { label: "Screening record", value: "Screening record unavailable" }];
  const tx = { label: "Transaction", value: s.txHash, href: explorerTx(s.txHash, network) };
  if (s.outcome === "failed") return [...f, { label: "Outcome", value: "The enclave returned no verdict" }, tx];
  if (s.outcome === "no_verdict") return [...f, { label: "Outcome", value: "No verdict within 15 minutes" }, tx];
  return [
    ...f,
    { label: "Outcome", value: OUTCOME[s.outcome] },
    ...(s.requestId !== null ? [{ label: "Request", value: String(s.requestId), href: s.jobId ? attestationUrl(s.jobId, network) : OUTLAYER_EXECUTIONS }] : []),
    ...(s.wasmHash ? [{ label: "Wasm", value: s.wasmHash, ...(s.wasmUrl ? { href: s.wasmUrl } : {}) }] : []),
    ...(s.timeMs !== null ? [{ label: "Run time", value: `${(s.timeMs / 1000).toFixed(1)} s` }] : []),
    ...(s.costYocto ? [{ label: "Cost", value: `${formatAmount(BigInt(s.costYocto), 24)} NEAR` }] : []),
    tx,
  ];
}
