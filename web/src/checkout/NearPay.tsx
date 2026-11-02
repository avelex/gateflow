// "Browser wallet": the named-account warning, then the export's Pay button; the wallet code loads only on click.
import { useState } from "react";
import { Button, Icon } from "../ds.jsx";
import { formatAmount } from "../format.ts";
import type { CheckoutInvoice } from "./logic.ts";

export const NAMED_WARNING = "Payments sent from named NEAR accounts (like alice.near) are returned by current screening. Pay from another chain to avoid this.";
const SENT = (id: number) => `gateflow:sent:${id}`;

/// Whether this browser already sent a wallet payment for the invoice (survives the wallet's redirect).
export function wasSent(id: number): boolean {
  try {
    // A redirect wallet returns with ?errorCode= when the payer rejected the transaction.
    if (new URLSearchParams(location.search).has("errorCode")) sessionStorage.removeItem(SENT(id));
    return sessionStorage.getItem(SENT(id)) === "1";
  } catch {
    return false;
  }
}

export function NamedWarning() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "14px 16px", border: "1px solid var(--border-1)", borderRadius: "var(--radius-2)", background: "var(--ink-50)" }}>
      <span style={{ color: "var(--amber-700)", paddingTop: 1 }}>
        <Icon name="triangle-alert" size={16} />
      </span>
      <span style={{ fontSize: 13, lineHeight: "19px", color: "var(--text-2)" }}>{NAMED_WARNING}</span>
    </div>
  );
}

export function NearPayButton({ inv, onSent }: { inv: CheckoutInvoice; onSent(): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const amount = `${formatAmount(BigInt(inv.amount), inv.decimals)} ${inv.symbol}`;
  const pay = async () => {
    setBusy(true);
    setError(undefined);
    try {
      try {
        sessionStorage.setItem(SENT(inv.id), "1");
      } catch {
        // without storage, the page shows the timeline once the invoice turns Paying
      }
      const { payDirect } = await import("./wallet.ts");
      await payDirect(inv);
      onSent();
    } catch (e) {
      try {
        sessionStorage.removeItem(SENT(inv.id));
      } catch {
        // nothing stored
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="primary" fullWidth icon="wallet" disabled={busy} onClick={pay}>
        {`Connect wallet and pay ${amount}`}
      </Button>
      {error && <span style={{ fontSize: 12, lineHeight: "18px", color: "var(--red-700)", textAlign: "center" }}>{error}</span>}
    </>
  );
}
