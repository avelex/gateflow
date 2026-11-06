// The export's "Balance" screen, read-only: payout account balances, and payments still in screening or stuck.
import { navigate } from "../App.tsx";
import { tokenIcon } from "../assets.ts";
import { formatAmount } from "../format.ts";
import type { ScreenProps } from "./Layout.tsx";
import { heldByToken } from "./logic.ts";

const COLS = "minmax(200px,1.4fr) repeat(3,minmax(140px,1fr))";

export default function Balance({ data }: ScreenProps) {
  const pending = heldByToken(data.payments, "Pending");
  const stuck = heldByToken(data.payments, "SettleFailed");
  const oldestStuck = (token: string) =>
    data.payments.filter((p) => p.status === "SettleFailed" && p.token === token).sort((a, b) => a.opened_at_sec - b.opened_at_sec)[0];
  const amount = (raw: bigint | undefined, b: { decimals: number; symbol: string }) => (raw ? `${formatAmount(raw, b.decimals)} ${b.symbol}` : "—");

  return (
    <div data-screen-label="Balance" style={{ flex: 1, overflow: "auto", padding: 32 }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1 style={{ margin: 0, fontSize: 26, lineHeight: "32px", fontWeight: 600, letterSpacing: "-0.015em" }}>Balance</h1>
          <span style={{ fontSize: 14, color: "var(--text-2)" }}>
            Funds in your payout account <span style={{ fontFamily: "var(--font-mono)" }}>{data.gateway.payout_to}</span>, and payments still held in screening.
          </span>
        </div>
        <div style={{ background: "var(--surface-card)", border: "1px solid var(--border-1)", borderRadius: "var(--radius-2)", overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 16, minWidth: 680, padding: "10px 20px", borderBottom: "1px solid var(--border-1)", background: "var(--ink-50)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" }}>
            <span>Token</span>
            <span style={{ textAlign: "right" }}>Available</span>
            <span style={{ textAlign: "right" }}>In screening</span>
            <span style={{ textAlign: "right" }}>Stuck</span>
          </div>
          {data.balances.map((b) => {
            const logo = tokenIcon(b.symbol);
            const s = stuck.get(b.token);
            const p = s ? oldestStuck(b.token) : undefined;
            return (
              <div key={b.token} className="hv" onClick={() => navigate("/console/invoices")} style={{ display: "grid", gridTemplateColumns: COLS, gap: 16, minWidth: 680, alignItems: "center", padding: "14px 20px", borderBottom: "1px solid var(--border-1)", fontSize: 14, fontVariantNumeric: "tabular-nums", cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  {logo ? (
                    <img src={logo} alt="" style={{ width: 28, height: 28, flex: "none", objectFit: "contain" }} />
                  ) : (
                    <span style={{ width: 28, height: 28, flex: "none", borderRadius: "50%", background: "var(--blue-500)", color: "var(--white)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700 }}>{b.symbol[0]}</span>
                  )}
                  <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.symbol}</span>
                </div>
                <span style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>{formatAmount(BigInt(b.balance), b.decimals)} {b.symbol}</span>
                <span style={{ textAlign: "right", whiteSpace: "nowrap", color: pending.get(b.token) ? "var(--amber-700)" : "var(--text-3)" }}>{amount(pending.get(b.token), b)}</span>
                <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {p ? (
                    <button onClick={(e) => (e.stopPropagation(), navigate(`/console/screening#payment-${p.id}`))} title="Open in Screening" style={{ border: 0, padding: 0, background: "none", cursor: "pointer", font: "inherit", color: "var(--red-700)", textDecoration: "underline" }}>
                      {amount(s, b)}
                    </button>
                  ) : (
                    <span style={{ color: "var(--text-3)" }}>—</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
