// The export's processing state: badge, title, text, then the timeline rows.
import type { ReactNode } from "react";
import { utcTime } from "../format.ts";
import type { Step } from "./logic.ts";

export type Headline = { badge: string; tone: "live" | "done" | "plain"; title: string; text: ReactNode };

export default function Timeline({ head, steps, details }: { head: Headline; steps: (Step & { d?: ReactNode })[]; details?: ReactNode }) {
  const fg = head.tone === "done" ? "var(--green-700)" : head.tone === "plain" ? "var(--text-2)" : "var(--blue-600)";
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ display: "flex" }}>
          <span style={{ fontSize: 13, lineHeight: "18px", whiteSpace: "nowrap", padding: "1px 0", background: "transparent", color: fg, fontWeight: 500, borderRadius: 2 }}>{head.badge}</span>
        </span>
        <span style={{ fontSize: 26, lineHeight: "32px", fontWeight: 600, letterSpacing: "-0.015em" }}>{head.title}</span>
        <span style={{ fontSize: 14, lineHeight: "22px", color: "var(--text-2)", textWrap: "pretty" }}>{head.text}</span>
      </div>
      {details}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {steps.map((r, i) => {
          const done = r.state === "done";
          const now = r.state === "current";
          return (
            <div key={r.label} style={{ display: "grid", gridTemplateColumns: "12px minmax(0,1fr) auto", gap: 16 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span style={{ width: 8, height: 8, marginTop: 6, flex: "none", background: done ? "var(--ee-blue)" : "var(--surface-card)", border: `2px solid ${done || now ? "var(--ee-blue)" : "var(--ink-300)"}` }} />
                <span style={{ flex: 1, width: 2, marginTop: 4, background: i === steps.length - 1 ? "transparent" : done ? "var(--ee-blue)" : "var(--ink-200)" }} />
              </div>
              <div style={{ paddingBottom: 18, display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: done || now ? "var(--text-1)" : "var(--text-3)" }}>{r.label}</span>
                {(r.d ?? r.detail) && <span style={{ fontSize: 13, lineHeight: "19px", color: "var(--text-2)" }}>{r.d ?? r.detail}</span>}
              </div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: "20px", color: "var(--text-3)", whiteSpace: "nowrap" }}>{r.atSec !== undefined ? utcTime(r.atSec) : ""}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
