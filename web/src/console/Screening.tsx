// The export's "AML" screen as Screening: payments the enclave holds, returned, or whose transfer failed.
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { Button, Stat, Tabs } from "../ds.jsx";
import { nowSec } from "./cards.tsx";
import type { ScreenProps } from "./Layout.tsx";
import { amountOf, type Payment, payerLabel, screeningTab } from "./logic.ts";
import { message } from "./Onboarding.tsx";

type Tab = "Pending" | "Refunded" | "Failed";
const TABS: Tab[] = ["Pending", "Refunded", "Failed"];

/// The export's age text: "14 min", "3 h 07 min", "1 d 2 h".
export function age(sec: number): string {
  const m = Math.max(0, Math.floor(sec / 60));
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
  return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
}

const NOTE: Record<Tab, (p: Payment) => { check: string; note: string }> = {
  Pending: () => ({ check: "Screening in enclave", note: "Released to you, or returned to the payer, once the check completes." }),
  Refunded: (p) => ({ check: "Returned to the payer", note: `Sent back to ${p.refund_to}.` }),
  Failed: (p) => ({
    check: p.status === "SettleFailed" ? "Release failed" : "Return failed",
    note: p.status === "SettleFailed" ? "Your payout account could not receive this token. Retry once it can." : `${p.refund_to} could not receive this token. Retry once it can.`,
  }),
};

function Tag({ tab }: { tab: Tab }) {
  const act = tab === "Failed";
  return (
    <span style={{ display: "flex" }}>
      <span style={{ fontSize: 13, lineHeight: "18px", whiteSpace: "nowrap", padding: act ? "1px 7px" : "1px 0", background: act ? "var(--red-700)" : "transparent", color: act ? "#fff" : tab === "Pending" ? "var(--blue-600)" : "var(--text-2)", fontWeight: act ? 600 : 400, borderRadius: 2 }}>
        {tab === "Pending" ? "Screening" : tab === "Refunded" ? "Returned" : "Failed"}
      </span>
    </span>
  );
}

export default function Screening({ data, refresh, toast }: ScreenProps) {
  const [tab, setTab] = useState<string>("Pending");
  const [busy, setBusy] = useState<number>();
  useEffect(() => {
    const m = /^#payment-(\d+)$/.exec(location.hash);
    const p = m && data.payments.find((x) => x.id === Number(m[1]));
    const t = p && screeningTab(p);
    if (t) setTab(t);
    // Only on arrival from Search; later data refreshes keep the chosen tab.
  }, []);

  const count = (t: Tab) => data.payments.filter((p) => screeningTab(p) === t).length;
  const rows = data.payments.filter((p) => screeningTab(p) === tab);
  const settled = data.payments.filter((p) => p.status === "Settled").length;
  const now = nowSec();

  const retry = async (p: Payment) => {
    setBusy(p.id);
    try {
      await api("POST", "/console/retry", { payment: p.id });
      toast("Retry sent", `Invoice #${p.invoice}`);
      refresh();
    } catch (e) {
      toast("Retry failed", message(e));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div data-screen-label="AML" style={{ flex: 1, overflow: "auto", padding: 32 }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1 style={{ margin: 0, fontSize: 26, lineHeight: "32px", fontWeight: 600, letterSpacing: "-0.015em" }}>Screening</h1>
          <span style={{ fontSize: 14, color: "var(--text-2)" }}>Payments held in the Gateflow contract while the enclave screens the payer.</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 0, background: "var(--surface-card)", border: "1px solid var(--border-1)", borderRadius: "var(--radius-2)" }}>
          <div style={{ padding: "16px 20px", borderRight: "1px solid var(--border-1)" }}>
            <Stat label="Screening" value={count("Pending")} sub="in the enclave" />
          </div>
          <div style={{ padding: "16px 20px", borderRight: "1px solid var(--border-1)" }}>
            <Stat label="Returned" value={count("Refunded")} sub="to the payer" />
          </div>
          <div style={{ padding: "16px 20px", borderRight: "1px solid var(--border-1)" }}>
            <Stat label="Failed" value={count("Failed")} sub="need a retry" />
          </div>
          <div style={{ padding: "16px 20px" }}>
            <Stat label="Released" value={settled} sub="to your payout account" />
          </div>
        </div>
        <Tabs tabs={TABS.map((t) => ({ value: t, label: t, count: count(t) }))} value={tab} onChange={setTab} />
        <div style={{ background: "var(--surface-card)", border: "1px solid var(--border-1)", borderRadius: "var(--radius-2)", overflow: "hidden" }}>
          {rows.map((p) => {
            const t = screeningTab(p)!;
            const n = NOTE[t](p);
            return (
              <div key={p.id} id={`payment-${p.id}`} style={{ display: "grid", gridTemplateColumns: "150px minmax(0,1fr) 110px auto", gap: 20, alignItems: "center", padding: "16px 20px", borderBottom: "1px solid var(--border-1)" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                    {amountOf(p)} {p.tokenMeta.symbol}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-3)" }}>
                    #{p.invoice} · {payerLabel(p)}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{n.check}</span>
                  <span style={{ fontSize: 13, color: "var(--text-2)" }}>{n.note}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <Tag tab={t} />
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>held {age(now - p.opened_at_sec)}</span>
                </div>
                <div>
                  {t === "Failed" && (
                    <Button variant="secondary" size="sm" icon="rotate-cw" disabled={busy === p.id} onClick={() => retry(p)}>
                      Retry
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && <div style={{ padding: "16px 20px", fontSize: 14, color: "var(--text-3)" }}>Nothing here.</div>}
        </div>
      </div>
    </div>
  );
}
