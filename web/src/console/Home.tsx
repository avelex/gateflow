// The export's "New chat" screen as Home: greeting, today's settled totals, the assistant composer and hint chips.
import { useEffect, useState } from "react";
import { navigate } from "../App.tsx";
import { tokenIcon } from "../assets.ts";
import { Button, Icon } from "../ds.jsx";
import type { ScreenProps } from "./Layout.tsx";
import { ask, settledToday } from "./logic.ts";

export const HINTS = ["Create invoice for 0.01 BTC", "Which invoices are unpaid?", "What was returned this week?", "Lower my risk tolerance"];

const greeting = (h: number) => (h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");

export default function Home({ data }: ScreenProps) {
  const [tick, setTick] = useState(0);
  const [draft, setDraft] = useState("");
  const send = (text: string) => ask(text, navigate);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 4200);
    return () => clearInterval(t);
  }, []);
  const now = new Date();
  const totals = settledToday(data.payments, now);
  const shown = totals[tick % Math.max(1, totals.length)];
  const icon = shown && tokenIcon(shown.symbol);
  const first = (data.me.name ?? "").split(/\s+/)[0];

  return (
    <div data-screen-label="New chat" style={{ flex: 1, overflow: "auto", padding: "0 32px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "16vh 0 48px", display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h1 style={{ margin: 0, display: "flex", alignItems: "center", gap: 14, fontSize: 36, lineHeight: "42px", fontWeight: 600, letterSpacing: "-0.02em" }}>
            {greeting(now.getHours())}
            {first ? `, ${first}` : ""}
          </h1>
          <p style={{ margin: 0, fontSize: 17, lineHeight: "26px", fontWeight: 500, color: "var(--text-2)", display: "flex", alignItems: "center", gap: 8 }}>
            Today you processed:{" "}
            <span key={tick} style={{ display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "center", fontWeight: 700, color: "var(--text-1)", fontVariantNumeric: "tabular-nums", animation: "dfTickIn 600ms cubic-bezier(.2,0,0,1) both" }}>
              {icon && <img src={icon} alt="" style={{ width: 18, height: 18, display: "block", objectFit: "contain" }} />}
              {shown ? `${shown.amount} ${shown.symbol}` : "nothing yet"}
            </span>
          </p>
        </div>

        <div style={{ background: "var(--surface-card)", border: "1px solid var(--border-2)", borderRadius: "var(--radius-3)", boxShadow: "var(--shadow-1)", padding: "16px 12px 10px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <textarea
            rows={3}
            aria-label="Ask Gateflow"
            placeholder="Ask Gateflow to create an invoice or check a payment"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send(draft))}
            style={{ border: 0, outline: 0, resize: "none", fontFamily: "var(--font-sans)", fontSize: 16, lineHeight: "24px", background: "transparent", color: "var(--text-1)", padding: 0, width: "100%" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1 }} />
            <Button variant="primary" size="sm" icon="arrow-up" disabled={!draft.trim()} onClick={() => send(draft)} />
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {HINTS.map((h) => (
            <div key={h} className="hv" onClick={() => send(h)} style={{ display: "flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", border: "1px solid var(--border-2)", borderRadius: "var(--radius-2)", background: "var(--surface-card)", fontSize: 13, color: "var(--text-2)", cursor: "pointer" }}>
              <Icon name="sparkles" size={13} />
              {h}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
