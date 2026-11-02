// Pure checkout rules (tested in logic.test.ts).
import { isNearAccount } from "../format.ts";

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
};

export type Step = { label: string; state: "done" | "current" | "todo"; detail?: string };

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
export type SavedQuote = { ref: string; depositAddress: string; depositMemo: string | null; amountIn: string; amountInFormatted: string | null; deadline: string; symbol?: string };
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
