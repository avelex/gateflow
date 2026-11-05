// The export's chat cards (design/Gateflow Console.html, Chat): invoice, status and confirm.
import { Fragment, type ReactNode, useEffect, useState } from "react";
import { api } from "../api.ts";
import { Badge, Button, FlowSteps, Hash, Icon, IconButton, Tabs } from "../ds.jsx";
import { chainName } from "../assets.ts";
import { explorerTx } from "../checkout/logic.ts";
import { keyMode } from "../near/key.ts";
import { acquireKey, amountOf, type Card, cardModel, type ChatAction, type Invoice, invoiceSteps, invoiceTab, type Payment, payerAddress, payerLabel, screeningFields, signAndRelay, TGAS } from "./logic.ts";
import type { ConsoleData } from "./Layout.tsx";
import { message } from "./Onboarding.tsx";

export const LABEL = { fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" } as const;
const BOX = { background: "var(--surface-card)", border: "1px solid var(--border-1)", borderRadius: "var(--radius-2)", overflow: "hidden" } as const;
const HEAD = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 20px", borderBottom: "1px solid var(--border-1)" } as const;
const FOOT = { display: "flex", flexWrap: "wrap", gap: 8, padding: "12px 20px", borderTop: "1px solid var(--border-1)", background: "var(--ink-50)" } as const;

export const utc = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 16).replace("T", " ");
export const nowSec = () => Math.floor(Date.now() / 1000);
export const checkoutLink = (id: number) => `${location.origin}/pay/${id}`;
export const NETWORK = import.meta.env.VITE_NEAR_NETWORK ?? "testnet";

/// The export's status tag, in its plain form; in-flight states use the export's "Checking" blue.
export function StatusTag({ label }: { label: string }) {
  const live = label === "Paying" || label === "Pending" || label === "Screening";
  return (
    <span style={{ display: "flex" }}>
      <span style={{ fontSize: 13, lineHeight: "18px", whiteSpace: "nowrap", padding: "1px 0", background: "transparent", color: live ? "var(--blue-600)" : "var(--text-2)", fontWeight: 400, borderRadius: 2 }}>{label}</span>
    </span>
  );
}

const TONE: Record<string, "success" | "accent" | "warning" | "neutral"> = { Paid: "success", Paying: "accent", Returned: "warning" };
const SECTION = { ...LABEL, marginBottom: 4 } as const;
const short = (v: string) => (v.length > 16 ? `${v.slice(0, 6)}…${v.slice(-4)}` : v);
const MONO = /^(Transaction|Deposit address|Attestation|Token contract)$/;

/// One Passport row: label, then the value as a link, a copyable hash, or text.
const passportRow = (f: { label: string; value: string; href?: string }) => (
  <div key={f.label} style={{ display: "grid", gridTemplateColumns: "136px minmax(0,1fr)", alignItems: "center", gap: 16, minHeight: 36, borderBottom: "1px solid var(--ink-100)" }}>
    <span style={{ fontSize: 13, color: "var(--text-3)" }}>{f.label}</span>
    {f.href ? (
      <a href={f.href} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-link)", textDecoration: "none", fontSize: MONO.test(f.label) ? 13 : 14, fontFamily: MONO.test(f.label) ? "var(--font-mono)" : undefined }}>
        {MONO.test(f.label) ? short(f.value) : f.value}
        <Icon name="external-link" size={13} />
      </a>
    ) : MONO.test(f.label) ? (
      <Hash value={f.value} />
    ) : (
      <span style={{ fontSize: 14 }}>{f.value}</span>
    )}
  </div>
);

/// The invoice modal (design option B): header actions, amount and payer, then Timeline and Passport tabs.
export function InvoiceCard({ inv, tab, payment, project, txHash, onCopy, onClose }: { inv: Invoice; tab: string; payment?: Payment; project: string; txHash?: string; onCopy(): void; onClose?(): void }) {
  const [view, setView] = useState("Timeline");
  const steps = invoiceSteps(inv, payment, NETWORK, nowSec());
  const payer = payment && payerAddress(payment, NETWORK);
  return (
    <div style={BOX}>
      <div style={{ ...HEAD, padding: "12px 12px 12px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Invoice</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-3)" }}>#{inv.id}</span>
          <Badge tone={TONE[tab] ?? "neutral"} dot>
            {tab}
          </Badge>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Button variant="primary" size="sm" icon="copy" onClick={onCopy}>
            Copy payment link
          </Button>
          <IconButton icon="external-link" label="Open checkout" size="sm" onClick={() => window.open(checkoutLink(inv.id), "_blank")} />
          {onClose && (
            <>
              <span aria-hidden="true" style={{ width: 1, height: 20, margin: "0 4px", background: "var(--border-1)" }} />
              <IconButton icon="x" label="Close" size="sm" onClick={onClose} />
            </>
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "20px 24px 0" }}>
        <div style={{ fontSize: 36, lineHeight: "42px", fontWeight: 600, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
          {amountOf(inv)} <span style={{ fontSize: 17, fontWeight: 500, color: "var(--text-3)", letterSpacing: 0 }}>{inv.tokenMeta.symbol}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 28, fontSize: 14, color: "var(--text-2)" }}>
          {payer ? (
            <>
              <span>from</span>
              <Hash value={payer.address} />
              {payment?.origin && <span>on {chainName(payment.origin.chain)}</span>}
              {payer.href && (
                <a href={payer.href} target="_blank" rel="noreferrer" aria-label="Open payer in explorer" style={{ display: "flex", color: "var(--text-3)" }}>
                  <Icon name="external-link" size={14} />
                </a>
              )}
            </>
          ) : (
            <span style={{ color: "var(--text-3)" }}>Not paid yet</span>
          )}
        </div>
      </div>
      <div style={{ padding: "12px 24px 0" }}>
        <Tabs tabs={["Timeline", "Passport"]} value={view} onChange={setView} />
      </div>
      {view === "Timeline" ? (
        <div style={{ padding: "18px 24px 24px", display: "flex", flexDirection: "column" }}>
          <span style={{ ...LABEL, marginBottom: 14 }}>Times in UTC</span>
          <div style={{ display: "grid", gridTemplateColumns: "20px minmax(0,1fr) auto", columnGap: 14 }}>
            {steps.map((st, i) => {
              const last = i === steps.length - 1;
              return (
                <Fragment key={st.title}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    {last && st.done ? (
                      <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--green-600)", color: "var(--text-inverse)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Icon name="check" size={12} strokeWidth={3} />
                      </span>
                    ) : (
                      <span aria-hidden="true" style={{ width: 10, height: 10, marginTop: 5, borderRadius: "50%", boxSizing: "border-box", background: st.done ? "var(--green-600)" : "var(--surface-card)", border: st.done ? "none" : "2px solid var(--border-2)" }} />
                    )}
                    {!last && <span aria-hidden="true" style={{ flex: 1, width: 2, background: "var(--border-2)" }} />}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: last ? 0 : 18 }}>
                    <span style={{ fontSize: 14, fontWeight: last ? 600 : 500, color: st.done ? "var(--text-1)" : "var(--text-3)" }}>{st.title}</span>
                    {(st.detail || st.link) && (
                      <span style={{ fontSize: 13, color: "var(--text-3)" }}>
                        {st.detail}
                        {st.detail && st.link && " · "}
                        {st.link && (
                          <a href={st.link.href} target="_blank" rel="noreferrer" style={{ color: "var(--text-link)", textDecoration: "none" }}>
                            {st.link.label}
                          </a>
                        )}
                      </span>
                    )}
                  </div>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-2)", paddingTop: 2, whiteSpace: "nowrap" }}>{st.atSec ? utc(st.atSec) : ""}</span>
                </Fragment>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ padding: "16px 24px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={SECTION}>Invoice</span>
            {inv.memo && passportRow({ label: "Memo", value: inv.memo })}
            {passportRow({ label: "Token contract", value: inv.token })}
            {passportRow({ label: "Payment", value: inv.payment === null ? "—" : `#${inv.payment}` })}
            {txHash && passportRow({ label: "Transaction", value: txHash, href: explorerTx(txHash, NETWORK) })}
          </div>
          {payment && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={SECTION}>Screening</span>
              {screeningFields(payment, project, NETWORK).map(passportRow)}
            </div>
          )}
        </div>
      )}
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
      <InvoiceCard inv={inv} tab={invoiceTab(inv, nowSec())} payment={p} project={data.gateway.outlayerProject} onCopy={() => (navigator.clipboard?.writeText(checkoutLink(inv.id)), toast("Payment link copied", checkoutLink(inv.id)))} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <div className="hv" onClick={() => onAsk(follow)} style={{ display: "flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", border: "1px solid var(--border-2)", borderRadius: "var(--radius-2)", background: "var(--surface-card)", fontSize: 13, color: "var(--text-2)", cursor: "pointer" }}>
          <Icon name="corner-down-right" size={13} />
          {follow}
        </div>
      </div>
    </>
  );
}
