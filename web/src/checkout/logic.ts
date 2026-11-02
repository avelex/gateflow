// Pure checkout rules (tested in logic.test.ts).

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
