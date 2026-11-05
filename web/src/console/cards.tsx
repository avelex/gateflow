// The export's chat cards (design/Gateflow Console.html, Chat): invoice, status and confirm.
import { Fragment, type ReactNode, useEffect, useState } from "react";
import { api } from "../api.ts";
import { Button, FlowSteps, Icon } from "../ds.jsx";
import { keyMode } from "../near/key.ts";
import { acquireKey, amountOf, type Card, cardModel, type ChatAction, type Invoice, invoiceTab, invoiceTime, type Payment, payerLabel, screeningFields, signAndRelay, TGAS } from "./logic.ts";
import type { ConsoleData } from "./Layout.tsx";
import { message } from "./Onboarding.tsx";

export const LABEL = { fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" } as const;
const BOX = { background: "var(--surface-card)", border: "1px solid var(--border-1)", borderRadius: "var(--radius-2)", overflow: "hidden" } as const;
const HEAD = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 20px", borderBottom: "1px solid var(--border-1)" } as const;
const FOOT = { display: "flex", flexWrap: "wrap", gap: 8, padding: "12px 20px", borderTop: "1px solid var(--border-1)", background: "var(--ink-50)" } as const;

export const utc = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 16).replace("T", " ");
export const nowSec = () => Math.floor(Date.now() / 1000);
export const checkoutLink = (id: number) => `${location.origin}/pay/${id}`;
const NETWORK = import.meta.env.VITE_NEAR_NETWORK ?? "testnet";

/// The export's status tag, in its plain form; in-flight states use the export's "Checking" blue.
export function StatusTag({ label }: { label: string }) {
  const live = label === "Paying" || label === "Pending" || label === "Screening";
  return (
    <span style={{ display: "flex" }}>
      <span style={{ fontSize: 13, lineHeight: "18px", whiteSpace: "nowrap", padding: "1px 0", background: "transparent", color: live ? "var(--blue-600)" : "var(--text-2)", fontWeight: 400, borderRadius: 2 }}>{label}</span>
    </span>
  );
}

const field = (label: string, value: ReactNode, mono = false) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
    <span style={LABEL}>{label}</span>
    <span style={mono ? { fontFamily: "var(--font-mono)", fontSize: 13, wordBreak: "break-all" } : { fontSize: 14 }}>{value}</span>
  </div>
);

/// The export's chat invoice card: amount, checkout link, and Copy payment link / Open checkout.
export function InvoiceCard({ inv, tab, payer, payment, project, txHash, onCopy }: { inv: Invoice; tab: string; payer: string; payment?: Payment; project: string; txHash?: string; onCopy(): void }) {
  return (
    <div style={BOX}>
      <div style={HEAD}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="file-text" size={16} />
          <span style={{ fontSize: 15, fontWeight: 600 }}>Invoice</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-3)" }}>#{inv.id}</span>
        </div>
        <StatusTag label={tab} />
      </div>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 36, lineHeight: "42px", fontWeight: 600, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
            {amountOf(inv)} <span style={{ fontSize: 17, fontWeight: 500, color: "var(--text-3)", letterSpacing: 0 }}>{inv.tokenMeta.symbol}</span>
          </div>
          <div style={{ fontSize: 13, color: "var(--text-2)" }}>
            {invoiceTime(inv, payment).label.toLowerCase()} {utc(invoiceTime(inv, payment).sec)} UTC
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "16px 24px" }}>
          {field("Checkout link", checkoutLink(inv.id), true)}
          {field("Memo", inv.memo ?? "—")}
          {field("Payer", payer)}
          {field("Status", tab)}
        </div>
        <details style={{ fontSize: 13, color: "var(--text-2)" }}>
          <summary style={{ cursor: "pointer", ...LABEL }}>Details</summary>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "12px 24px", marginTop: 12 }}>
            {field("Token contract", inv.token, true)}
            {field("Payment", inv.payment === null ? "—" : `#${inv.payment}`, true)}
            {txHash && field("Transaction", txHash, true)}
          </div>
          {payment && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
              <span style={LABEL}>Screening</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "12px 24px" }}>
                {screeningFields(payment, project, NETWORK).map((f) => (
                  <Fragment key={f.label}>
                  {field(
                    f.label,
                    f.href ? (
                      <a href={f.href} target="_blank" rel="noreferrer" style={{ color: "var(--blue-600)", textDecoration: "none" }}>
                        {f.value}
                      </a>
                    ) : (
                      f.value
                    ),
                    /^(Wasm|Transaction|Deposit address|Project|Request)$/.test(f.label),
                  )}
                  </Fragment>
                ))}
              </div>
            </div>
          )}
        </details>
      </div>
      <div style={FOOT}>
        <Button variant="primary" size="sm" icon="copy" onClick={onCopy}>
          Copy payment link
        </Button>
        <Button variant="secondary" size="sm" icon="external-link" onClick={() => window.open(checkoutLink(inv.id), "_blank")}>
          Open checkout
        </Button>
      </div>
    </div>
  );
}

/// The export's chat status card: amount, payer and the Delivered, Screening, Released or Returned steps.
function StatusCard({ model }: { model: Extract<ReturnType<typeof cardModel>, { kind: "status" }> }) {
  const { invoice: inv, payment } = model;
  return (
    <div style={BOX}>
      <div style={HEAD}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <Icon name="shield-check" size={16} />
          <span style={{ fontSize: 15, fontWeight: 600 }}>Invoice #{inv.id}</span>
        </div>
        <StatusTag label={model.label} />
      </div>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "8px 24px" }}>
          <div style={{ fontSize: 26, lineHeight: "32px", fontWeight: 600, letterSpacing: "-0.015em", fontVariantNumeric: "tabular-nums" }}>
            {amountOf(inv)} <span style={{ fontSize: 15, fontWeight: 500, color: "var(--text-3)", letterSpacing: 0 }}>{inv.tokenMeta.symbol}</span>
          </div>
          <div style={{ fontSize: 13, color: "var(--text-2)" }}>{payment ? payerLabel(payment) : "Not paid yet"}</div>
        </div>
        <FlowSteps steps={model.steps.map((title) => ({ title }))} current={model.current} />
      </div>
    </div>
  );
}

const STATUS_LABEL = { pending: "Pending", done: "Done", dismissed: "Dismissed", failed: "Failed" } as const;

/// A proposed change with its exact values. Confirm signs it with the passkey (or asks the operator, for retries).
function ConfirmCard({ actionId, onDone }: { actionId: number; onDone(): void }) {
  const [a, setA] = useState<ChatAction>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const load = () => api<ChatAction>("GET", `/console/action?id=${actionId}`).then(setA, (e) => setError(message(e)));
  useEffect(() => void load(), [actionId]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      load();
    }
  };
  const confirm = () =>
    run(async () => {
      if (a!.kind === "retry") return api("POST", "/console/actions/confirm", { id: actionId });
      return signAndRelay(await acquireKey(keyMode()), [{ method: a!.kind, args: a!.params, gas: 30n * TGAS }], actionId);
    });
  const dismiss = () => run(() => api("POST", "/console/actions/dismiss", { id: actionId }));

  if (!a) return error ? <div style={{ fontSize: 13, color: "var(--red-700)" }}>{error}</div> : null;
  const pending = a.status === "pending";
  return (
    <div style={BOX}>
      <div style={HEAD}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <Icon name={a.kind === "retry" ? "rotate-cw" : "key-round"} size={16} />
          <span style={{ fontSize: 15, fontWeight: 600 }}>{a.summary}</span>
        </div>
        {!pending && <StatusTag label={STATUS_LABEL[a.status]} />}
      </div>
      <div style={{ padding: "14px 20px", fontSize: 13, color: "var(--text-2)" }}>
        {pending ? (a.kind === "retry" ? "Gateflow retries this payment when you confirm." : "Nothing changes until you confirm with your passkey.") : a.status === "failed" ? a.result?.error : a.status === "dismissed" ? "Nothing changed." : "Done. The result is in this thread."}
        {error && <div style={{ marginTop: 8, color: "var(--red-700)" }}>{error}</div>}
      </div>
      {pending && (
        <div style={FOOT}>
          <Button variant="primary" size="sm" icon={a.kind === "retry" ? "check" : "key-round"} disabled={busy} onClick={confirm}>
            Confirm
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={dismiss}>
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}

/// One chat card, rendered from the console's live data.
export function ChatCard({ card, data, onAsk, onChanged, toast }: { card: Card; data: ConsoleData; onAsk(text: string): void; onChanged(): void; toast(title: string, body?: string): void }) {
  const model = cardModel(card, data);
  if (model.kind === "loading") return <div style={{ fontSize: 13, color: "var(--text-3)" }}>Loading invoice…</div>;
  if (model.kind === "confirm") return <ConfirmCard actionId={model.actionId} onDone={onChanged} />;
  if (model.kind === "status") return <StatusCard model={model} />;
  const inv = model.invoice;
  const p = inv.payment === null ? undefined : data.payments.find((x) => x.id === inv.payment);
  const follow = `What is the status of invoice #${inv.id}?`;
  return (
    <>
      <InvoiceCard inv={inv} tab={invoiceTab(inv, nowSec())} payer={p ? payerLabel(p) : "Not paid yet"} payment={p} project={data.gateway.outlayerProject} onCopy={() => (navigator.clipboard?.writeText(checkoutLink(inv.id)), toast("Payment link copied", checkoutLink(inv.id)))} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <div className="hv" onClick={() => onAsk(follow)} style={{ display: "flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", border: "1px solid var(--border-2)", borderRadius: "var(--radius-2)", background: "var(--surface-card)", fontSize: 13, color: "var(--text-2)", cursor: "pointer" }}>
          <Icon name="corner-down-right" size={13} />
          {follow}
        </div>
      </div>
    </>
  );
}
