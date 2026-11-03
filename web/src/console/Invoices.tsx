// The export's "Invoices" screen. The detail view is the export's chat invoice card; the create form uses Dialog.
import { type ReactNode, useEffect, useState } from "react";
import { navigate } from "../App.tsx";
import { Button, Dialog, Icon, Input, Radio, Select, Tabs } from "../ds.jsx";
import { checkoutLink, InvoiceCard, LABEL, nowSec, StatusTag, utc } from "./cards.tsx";
import type { ScreenProps } from "./Layout.tsx";
import { acquireKey, amountOf, ask, EXPIRIES, type Invoice, invoiceArgs, invoiceTab, type InvoiceTab, payerLabel, signAndRelay, TGAS } from "./logic.ts";
import { keyMode } from "../near/key.ts";
import { message } from "./Onboarding.tsx";

const TABS: ("All" | InvoiceTab)[] = ["All", "Open", "Paying", "Paid", "Returned", "Expired"];
const GRID = "100px minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr) 150px 140px";

export default function Invoices({ data, refresh, toast }: ScreenProps) {
  const [tab, setTab] = useState<string>("All");
  const [open, setOpen] = useState<{ id: number; txHash?: string }>();
  const [creating, setCreating] = useState(false);
  const [question, setQuestion] = useState("");
  useEffect(() => {
    const m = /^#invoice-(\d+)$/.exec(location.hash);
    if (m) setOpen({ id: Number(m[1]) });
  }, []);

  const now = nowSec();
  const tabOf = (i: Invoice) => invoiceTab(i, now);
  const rows = data.invoices.filter((i) => tab === "All" || tabOf(i) === tab);
  const payer = (i: Invoice) => {
    const p = i.payment === null ? undefined : data.payments.find((x) => x.id === i.payment);
    return p ? payerLabel(p) : "Not paid yet";
  };
  const selected = open && data.invoices.find((i) => i.id === open.id);

  return (
    <div data-screen-label="Invoices" style={{ flex: 1, overflow: "auto", padding: 32 }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <h1 style={{ margin: 0, fontSize: 26, lineHeight: "32px", fontWeight: 600, letterSpacing: "-0.015em" }}>Invoices</h1>
            <span style={{ fontSize: 14, color: "var(--text-2)" }}>Every payment waits in your contract until checks complete.</span>
          </div>
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            New invoice
          </Button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, height: 44, padding: "0 8px 0 14px", background: "var(--surface-card)", border: "1px solid var(--border-2)", borderRadius: "var(--radius-3)" }}>
          <Icon name="message-square" size={16} />
          <input
            aria-label="Ask about invoices"
            placeholder="Ask about invoices — e.g. Which invoices are unpaid for more than 24 h?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask(question, navigate)}
            style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: "transparent", fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--text-1)" }}
          />
          <Button variant="ink" size="sm" icon="arrow-up" disabled={!question.trim()} onClick={() => ask(question, navigate)} />
        </div>
        <Tabs tabs={TABS.map((t) => ({ value: t, label: t, count: t === "All" ? data.invoices.length : data.invoices.filter((i) => tabOf(i) === t).length }))} value={tab} onChange={setTab} />
        <div style={{ background: "var(--surface-card)", border: "1px solid var(--border-1)", borderRadius: "var(--radius-2)", overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 16, minWidth: 780, padding: "10px 20px", borderBottom: "1px solid var(--border-1)", background: "var(--ink-50)", ...LABEL }}>
            <span>Invoice</span>
            <span>Payer</span>
            <span style={{ textAlign: "right" }}>Amount</span>
            <span>Memo</span>
            <span>Expires, UTC</span>
            <span>Status</span>
          </div>
          {rows.map((i) => (
            <div key={i.id} className="hv" onClick={() => setOpen({ id: i.id })} style={{ display: "grid", gridTemplateColumns: GRID, gap: 16, minWidth: 780, alignItems: "center", padding: "12px 20px", borderBottom: "1px solid var(--border-1)", cursor: "pointer", fontSize: 14 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>#{i.id}</span>
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{payer(i)}</span>
              <span style={{ textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                {amountOf(i)} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>{i.tokenMeta.symbol}</span>
              </span>
              <span style={{ color: "var(--text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.memo ?? ""}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-2)" }}>{utc(i.expires_at_sec)}</span>
              <StatusTag label={tabOf(i)} />
            </div>
          ))}
          <div style={{ padding: "12px 20px", background: "var(--ink-50)", fontSize: 13, color: "var(--text-3)" }}>{rows.length ? "Select a row to see its checkout link." : "No invoices here yet."}</div>
        </div>
      </div>

      {selected && (
        <InvoiceModal onClose={() => (setOpen(undefined), history.replaceState(null, "", location.pathname))}>
          <InvoiceCard
            inv={selected}
            tab={tabOf(selected)}
            payer={payer(selected)}
            payment={selected.payment === null ? undefined : data.payments.find((x) => x.id === selected.payment)}
            project={data.gateway.outlayerProject}
            txHash={open?.txHash}
            onCopy={() => (navigator.clipboard?.writeText(checkoutLink(selected.id)), toast("Payment link copied", checkoutLink(selected.id)))}
          />
        </InvoiceModal>
      )}
      {creating && (
        <CreateInvoice
          props={{ data, refresh, toast }}
          onClose={() => setCreating(false)}
          onCreated={(id, txHash) => (setCreating(false), refresh(), setOpen({ id, txHash }))}
        />
      )}
    </div>
  );
}

function InvoiceModal({ children, onClose }: { children: ReactNode; onClose(): void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 50, background: "rgba(10,12,16,.48)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "96px 32px 32px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 620, maxWidth: "100%" }}>
        {children}
      </div>
    </div>
  );
}

function CreateInvoice({ props, onClose, onCreated }: { props: ScreenProps; onClose(): void; onCreated(id: number, txHash: string): void }) {
  const tokens = props.data.tokens.filter((t) => t.enabled);
  const [token, setToken] = useState(tokens[0]?.token ?? "");
  const [amount, setAmount] = useState("");
  const [expiry, setExpiry] = useState<string>(EXPIRIES[0].label);
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const meta = tokens.find((t) => t.token === token);

  const create = async () => {
    setError(undefined);
    setBusy(true);
    try {
      const args = invoiceArgs({ gateway: props.data.gateway.id, token, decimals: meta!.decimals, amount, expiresInSec: EXPIRIES.find((e) => e.label === expiry)!.value, memo });
      const r = await signAndRelay(await acquireKey(keyMode()), [{ method: "create_invoice", args, gas: 30n * TGAS }]);
      onCreated(Number(r.value), r.txHash);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="New invoice"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" icon="key-round" disabled={busy || !meta || !amount} onClick={create}>
            Create invoice
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16, color: "var(--text-1)" }}>
        <Select label="Token" options={tokens.map((t) => ({ value: t.token, label: t.symbol }))} value={token} onChange={(e) => setToken(e.target.value)} />
        <Input label="Amount" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} suffix={meta?.symbol} error={error} />
        <div>
          <span style={{ display: "block", fontSize: "var(--fs-small)", fontWeight: 600, color: "var(--text-1)", marginBottom: 6 }}>Expires in</span>
          <Radio name="expiry" options={EXPIRIES.map((e) => e.label)} value={expiry} onChange={setExpiry} direction="row" />
        </div>
        <Input label="Memo" hint="Optional. Shown to the payer." placeholder="Table 7" value={memo} onChange={(e) => setMemo(e.target.value)} />
      </div>
    </Dialog>
  );
}
