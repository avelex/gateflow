// The export's "Search" overlay, over invoices, payments and chats. Enter with no match asks the assistant.
import { useState } from "react";
import { navigate } from "../App.tsx";
import { Icon } from "../ds.jsx";
import type { ConsoleData } from "./Layout.tsx";
import { amountOf, ask, payerLabel, searchMatches } from "./logic.ts";

const FAILED = new Set(["SettleFailed", "RefundFailed"]);

/// The export's status tag: plain text, or a filled red tag for states that need the merchant.
function Tag({ status }: { status: string }) {
  const act = FAILED.has(status);
  return (
    <span style={{ display: "flex" }}>
      <span style={{ fontSize: 13, lineHeight: "18px", whiteSpace: "nowrap", padding: act ? "1px 7px" : "1px 0", background: act ? "var(--red-700)" : "transparent", color: act ? "#fff" : status === "Pending" || status === "Paying" ? "var(--blue-600)" : "var(--text-2)", fontWeight: act ? 600 : 400, borderRadius: 2 }}>
        {act ? "Failed" : status}
      </span>
    </span>
  );
}

const SECTION = { padding: "12px 10px 4px", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" } as const;
const ROW = { display: "flex", alignItems: "center", gap: 12, padding: "9px 10px", borderRadius: "var(--radius-2)", cursor: "pointer", fontSize: 14 } as const;

export default function Search({ data, onClose }: { data: ConsoleData; onClose(): void }) {
  const [q, setQ] = useState("");
  const found = searchMatches(q, data.invoices, data.payments);
  // An empty query lists the newest invoices, as the export does.
  const invoices = q.trim() ? found.filter((m) => m.kind === "invoice").map((m) => data.invoices.find((i) => i.id === m.id)!) : data.invoices.slice(0, 8);
  const payments = found.filter((m) => m.kind === "payment").map((m) => data.payments.find((p) => p.id === m.id)!);
  const t = q.trim().toLowerCase();
  const chats = t ? data.threads.filter((x) => x.title.toLowerCase().includes(t)) : [];
  const none = !!t && found.length === 0 && chats.length === 0;
  const open = (path: string) => (onClose(), navigate(path));
  const payerOf = (paymentId: number | null) => {
    const p = paymentId === null ? undefined : data.payments.find((x) => x.id === paymentId);
    return p ? payerLabel(p) : "Not paid yet";
  };

  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 50, background: "rgba(10,12,16,.48)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "96px 32px 32px" }}>
      <div data-screen-label="Search" onClick={(e) => e.stopPropagation()} style={{ width: 620, maxWidth: "100%", background: "var(--surface-card)", borderRadius: "var(--radius-3)", boxShadow: "var(--shadow-pop)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, height: 52, padding: "0 16px", borderBottom: "1px solid var(--border-1)" }}>
          <Icon name="search" size={18} />
          <input autoFocus placeholder="Search invoices, payments and chats" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && none && (onClose(), ask(q, navigate))} style={{ flex: 1, border: 0, outline: 0, background: "transparent", fontFamily: "var(--font-sans)", fontSize: 16, color: "var(--text-1)" }} />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)", border: "1px solid var(--border-1)", borderRadius: "var(--radius-1)", padding: "1px 5px" }}>esc</span>
        </div>
        <div style={{ maxHeight: 420, overflow: "auto", padding: 8 }}>
          {invoices.length > 0 && <div style={{ ...SECTION, paddingTop: 8 }}>Invoices</div>}
          {invoices.map((i) => (
            <div key={`i${i.id}`} className="hv" onClick={() => open(`/console/invoices#invoice-${i.id}`)} style={ROW}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, width: 76 }}>#{i.id}</span>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-2)" }}>
                {payerOf(i.payment)} · {amountOf(i)} {i.tokenMeta.symbol}
                {i.memo ? ` · ${i.memo}` : ""}
              </span>
              <Tag status={i.status} />
            </div>
          ))}
          {payments.length > 0 && <div style={SECTION}>Payments</div>}
          {payments.map((p) => (
            <div key={`p${p.id}`} className="hv" onClick={() => open(`/console/screening#payment-${p.id}`)} style={ROW}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, width: 76 }}>#{p.invoice}</span>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-2)" }}>
                {payerLabel(p)} · {amountOf(p)} {p.tokenMeta.symbol}
              </span>
              <Tag status={p.status} />
            </div>
          ))}
          {chats.length > 0 && <div style={SECTION}>Chats</div>}
          {chats.map((c) => (
            <div key={`c${c.id}`} className="hv" onClick={() => open(`/console/chat/${c.id}`)} style={ROW}>
              <Icon name="message-square" size={14} />
              <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-2)" }}>{c.title}</span>
            </div>
          ))}
          {none && <div style={{ padding: "16px 10px", fontSize: 14, color: "var(--text-3)" }}>No matches. Press Enter to ask Gateflow.</div>}
        </div>
      </div>
    </div>
  );
}
