// Pure checkout rules (tested in logic.test.ts).
import { formatAmount, isNearAccount } from "../format.ts";

/// GET /checkout/invoice.
export type CheckoutInvoice = {
  id: number;
  gateway: number;
  merchant: string | null;
  contract: string;
  token: string;
  symbol: string;
  decimals: number;
  amount: string;
  memo: string | null;
  expiresAtSec: number;
  status: "Open" | "Paying" | "Paid" | "Returned";
  payment: { id: number; status: string; refundTo: string } | null;
  enclave?: { project: string; activeVersion: string | null };
  screening?: Screening | null;
  times?: StepTimes;
};

/// The relay's screening evidence for a payment (screening-evidence spec).
export type Screening = {
  txHash: string;
  requestId: number | null;
  project: string | null;
  wasmHash: string | null;
  wasmUrl: string | null;
  timeMs: number | null;
  costYocto: string | null;
  outcome: "pending" | "approved" | "rejected" | "failed" | "no_verdict";
  /// OutLayer's job id, which keys its attestation page; null until the relay finds it.
  jobId: number | null;
  /// Block times (UTC seconds) of the run's completion and the payment's close; null or absent when unknown.
  screenedAtSec?: number | null;
  closedAtSec?: number | null;
};

/// UTC seconds of each processing step; null when unknown (checkout-relay: Checkout invoice details).
export type StepTimes = { depositSeenAtSec: number | null; openedAtSec: number | null; screenedAtSec: number | null; closedAtSec: number | null };

/// `atSec`: when a done step happened (UTC seconds), when the relay knows.
export type Step = { label: string; state: "done" | "current" | "todo"; detail?: string; atSec?: number };

/// Why the page offers no payment options, or undefined when it should (Paying shows the timeline instead).
export function unpayable(inv: CheckoutInvoice, nowSec: number): "paid" | "returned" | "expired" | undefined {
  if (inv.status === "Paid") return "paid";
  if (inv.status === "Returned") return "returned";
  if (inv.status === "Open" && inv.expiresAtSec <= nowSec) return "expired";
  return undefined;
}

const NOT_ARRIVED = new Set(["PENDING_DEPOSIT", "UNKNOWN"]);
const ORIGIN_REFUND = new Set(["REFUNDED", "FAILED"]);

/// The status timeline. `quoteStatus` (1Click) is set only for a cross-chain payment and adds the Deposit step.
export function timeline(inv: CheckoutInvoice, quoteStatus?: string): Step[] {
  const delivered = inv.status !== "Open";
  const decided = inv.status === "Paid" || inv.status === "Returned";
  const steps: Step[] = [];
  const origin = quoteStatus !== undefined && !delivered && ORIGIN_REFUND.has(quoteStatus);
  if (quoteStatus !== undefined) {
    const arrived = delivered || !NOT_ARRIVED.has(quoteStatus);
    steps.push(origin ? { label: "Returned on the origin chain", state: "done" } : { label: "Deposit detected", state: arrived ? "done" : "current" });
  }
  const before = quoteStatus === undefined || (!origin && !NOT_ARRIVED.has(quoteStatus));
  steps.push({ label: "Delivered to contract", state: delivered ? "done" : before && !origin ? "current" : "todo" });
  steps.push({ label: "Screening in enclave", state: decided ? "done" : delivered ? "current" : "todo" });
  if (inv.status === "Returned") steps.push({ label: "Returned to you", state: "done", detail: inv.payment?.refundTo });
  else steps.push({ label: "Released to merchant", state: inv.status === "Paid" ? "done" : "todo" });
  const t = inv.times;
  const at: Record<string, number | null | undefined> = {
    "Deposit detected": t?.depositSeenAtSec,
    "Delivered to contract": t?.openedAtSec,
    "Screening in enclave": t?.screenedAtSec,
    "Released to merchant": t?.closedAtSec,
    "Returned to you": t?.closedAtSec,
  };
  for (const s of steps) {
    const sec = at[s.label];
    if (s.state === "done" && typeof sec === "number") s.atSec = sec;
  }
  return steps;
}

/// The direct NEAR payment: ft_transfer_call on the invoice token to the Gateflow contract, msg naming the invoice only.
export function transferCallArgs(inv: CheckoutInvoice) {
  return {
    receiverId: inv.token,
    method: "ft_transfer_call" as const,
    args: { receiver_id: inv.contract, amount: inv.amount, msg: JSON.stringify({ invoice: inv.id }) },
    // 300 Tgas: ft_on_transfer forwards 100 Tgas to OutLayer plus its callback.
    gas: "300000000000000",
    deposit: "1",
  };
}

/// The first missing or invalid field of the cross-chain form, or undefined when a quote may be requested.
export function quoteFormError(f: { originAsset: string; refundTo: string; refundOnNear: string }): "originAsset" | "refundTo" | "refundOnNear" | undefined {
  if (!f.originAsset) return "originAsset";
  if (!f.refundTo.trim()) return "refundTo";
  if (!isNearAccount(f.refundOnNear.trim())) return "refundOnNear";
  return undefined;
}

/// A 1Click quote this browser requested, kept so a reload resumes the deposit view and timeline.
/// `symbol` and `decimals` are the paying asset's.
export type SavedQuote = { ref: string; depositAddress: string; depositMemo: string | null; amountIn: string; amountInFormatted: string | null; deadline: string; symbol?: string; decimals?: number };

/// How much of the amount to send exceeds the invoice amount, as the 1Click fee and slippage buffer; undefined when none.
export function feeLine(q: SavedQuote, inv: Pick<CheckoutInvoice, "amount" | "decimals">, originDecimals: number): string | undefined {
  const d = Math.max(originDecimals, inv.decimals);
  const diff = BigInt(q.amountIn) * 10n ** BigInt(d - originDecimals) - BigInt(inv.amount) * 10n ** BigInt(d - inv.decimals);
  if (diff <= 0n) return undefined;
  return `${formatAmount(diff, d)} ${q.symbol ?? ""} of this covers the 1Click fee and slippage buffer.`.replace("  ", " ");
}
const QUOTE = (invoice: number) => `gateflow:quote:${invoice}`;
const store = (s?: Storage) => s ?? localStorage;

export function saveQuote(invoice: number, q: SavedQuote, s?: Storage): void {
  try {
    store(s).setItem(QUOTE(invoice), JSON.stringify(q));
  } catch {
    // without storage the quote lives only until reload
  }
}

export function loadQuote(invoice: number, s?: Storage): SavedQuote | undefined {
  try {
    const q = JSON.parse(store(s).getItem(QUOTE(invoice)) ?? "null");
    return q && typeof q.ref === "string" && typeof q.depositAddress === "string" && typeof q.deadline === "string" ? q : undefined;
  } catch {
    return undefined;
  }
}

export function clearQuote(invoice: number, s?: Storage): void {
  try {
    store(s).removeItem(QUOTE(invoice));
  } catch {
    // nothing stored
  }
}

/// The tx hash a redirect wallet returns in `?transactionHashes=`.
export function returnedHash(search: string): string | undefined {
  return new URLSearchParams(search).get("transactionHashes")?.split(",")[0] || undefined;
}

/// A direct-pay tx hash not yet accepted by the relay, kept across the wallet's redirect.
const TX = (invoice: number) => `gateflow:tx:${invoice}`;

export function saveTx(invoice: number, hash: string, s?: Storage): void {
  try {
    store(s).setItem(TX(invoice), hash);
  } catch {
    // without storage the hash is reported only from this page load
  }
}

export function loadTx(invoice: number, s?: Storage): string | undefined {
  try {
    return store(s).getItem(TX(invoice)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function clearTx(invoice: number, s?: Storage): void {
  try {
    store(s).removeItem(TX(invoice));
  } catch {
    // nothing stored
  }
}

export const OUTLAYER_EXECUTIONS = "https://app.outlayer.ai/executions";
export const TEE = "Screened by OutLayer in an Intel TDX enclave (TEE)";

export const attestationUrl = (jobId: number, network: string) => `https://app.outlayer.ai/attestation/${jobId}?network=${network}`;

export const explorerTx = (hash: string, network: string) => `https://${network === "testnet" ? "testnet." : ""}nearblocks.io/txns/${hash}`;

/// The pre-pay line naming the enclave project and, when known, its current code; never claims an unknown version.
export function currentCode(e: CheckoutInvoice["enclave"]): string | undefined {
  if (!e) return undefined;
  return e.activeVersion ? `Project ${e.project} · current code ${e.activeVersion.slice(0, 8)}` : `Project ${e.project}`;
}

export type Link = { label: string; href: string };

/// The "Screening in enclave" row text from the evidence, or undefined to keep the default description.
/// `failed` and `no_verdict` never name a wasm hash as the screening code.
export function screeningDetail(s: Screening | null | undefined, decided: boolean, network: string): { text: string; links: Link[] } | undefined {
  const tx = (s: Screening): Link => ({ label: "Transaction", href: explorerTx(s.txHash, network) });
  const outlayer: Link = { label: "OutLayer executions", href: OUTLAYER_EXECUTIONS };
  // Only a run that produced the shown evidence links to its attestation; failed and no_verdict never do.
  const run = (s: Screening): Link => (s.jobId ? { label: "TEE attestation", href: attestationUrl(s.jobId, network) } : outlayer);
  if (!s) return decided ? { text: "The screening record is unavailable.", links: [outlayer] } : undefined;
  if (s.outcome === "failed") return { text: "The enclave returned no verdict, so the payment was returned.", links: [tx(s)] };
  if (s.outcome === "no_verdict") return { text: "No verdict arrived within 15 minutes, so the payment was returned.", links: [tx(s)] };
  const facts = [
    s.requestId !== null && `request ${s.requestId}`,
    s.wasmHash && `code ${s.wasmHash.slice(0, 8)}`,
    s.timeMs !== null && `${(s.timeMs / 1000).toFixed(1)} s`,
  ].filter(Boolean);
  if (s.outcome === "pending") return facts.length ? { text: `Running in OutLayer · ${facts.join(" · ")}`, links: [tx(s), run(s)] } : undefined;
  const links = [tx(s), run(s), ...(s.wasmUrl ? [{ label: "Code", href: s.wasmUrl }] : [])];
  return { text: [TEE, ...facts].join(" · "), links };
}
