// The export's "Logged out" card (design/Gateflow Console.html), reused for every signed-out and onboarding card.
import type { ReactNode } from "react";
import { logo } from "../assets.ts";

export const ERROR_STYLE = { fontSize: 13, lineHeight: "18px", color: "var(--red-700)" } as const;

export default function AuthCard({ title, text, children }: { title: ReactNode; text?: ReactNode; children?: ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "var(--surface-page)", fontFamily: "var(--font-sans)", color: "var(--text-1)" }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
        <div style={{ width: 360, maxWidth: "100%", background: "var(--surface-card)", border: "1px solid var(--border-1)", borderRadius: "var(--radius-3)", padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
          <img src={logo} alt="gateflow" style={{ height: 32, alignSelf: "flex-start" }} />
          <div style={{ fontSize: 19, lineHeight: "26px", fontWeight: 600, letterSpacing: "-0.01em" }}>{title}</div>
          {text && <div style={{ fontSize: 14, color: "var(--text-2)" }}>{text}</div>}
          {children}
        </div>
      </div>
    </div>
  );
}
