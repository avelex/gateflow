// The export's "New chat" screen as Home: greeting, today's settled totals, and the assistant composer (disabled).
import { useEffect, useState } from "react";
import { tokenIcon } from "../assets.ts";
import { Button, IconButton } from "../ds.jsx";
import type { ScreenProps } from "./Layout.tsx";
import { settledToday } from "./logic.ts";

const greeting = (h: number) => (h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");

export default function Home({ data }: ScreenProps) {
  const [tick, setTick] = useState(0);
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
          <textarea rows={3} disabled placeholder="Assistant coming soon" style={{ border: 0, outline: 0, resize: "none", fontFamily: "var(--font-sans)", fontSize: 16, lineHeight: "24px", background: "transparent", color: "var(--text-1)", padding: 0, width: "100%" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <IconButton icon="paperclip" label="Attach file" size="sm" disabled />
            <span style={{ flex: 1 }} />
            <Button variant="primary" size="sm" icon="arrow-up" disabled />
          </div>
        </div>
      </div>
    </div>
  );
}
