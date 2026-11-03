// The public checkout at /pay/<id>, translated from design/Gateflow Checkout.html.
import { type ReactNode, useEffect, useState } from "react";
import { api, ApiError } from "../api.ts";
import { logo, tokenIcon } from "../assets.ts";
import { Button, Icon } from "../ds.jsx";
import { formatAmount, initials, timeLeft } from "../format.ts";
import CrossChainPay, { DepositPanel } from "./CrossChainPay.tsx";
import { FOOTNOTE } from "./footnote.ts";
import { type CheckoutInvoice, clearQuote, clearTx, currentCode, type Link, OUTLAYER_EXECUTIONS, loadQuote, loadTx, returnedHash, type SavedQuote, saveTx, screeningDetail, type Step, TEE, timeline, unpayable } from "./logic.ts";
import { NamedWarning, NearPayButton, wasSent } from "./NearPay.tsx";
import Timeline, { type Headline } from "./Timeline.tsx";

const SECTION = { fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" } as const;
const SANS = { fontFamily: "var(--font-sans)", fontSize: 14 };
const NETWORK = import.meta.env.VITE_NEAR_NETWORK ?? "testnet";
const SOURCE_URL: string | undefined = import.meta.env.VITE_ENCLAVE_SOURCE_URL || undefined;
const LINK = { color: "var(--blue-600)", textDecoration: "none" } as const;

function Links({ links }: { links: Link[] }) {
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {links.map((l) => (
        <a key={l.label} href={l.href} target="_blank" rel="noreferrer" style={LINK}>
          {l.label}
        </a>
      ))}
    </span>
  );
}

const CHECKS = [
  "Risk score of the paying address",
  "OFAC sanctions lists for Bitcoin and Zcash senders",
  "For a cross-chain payment, the swap must match this invoice",
];

/// The pre-pay "How screening works" disclosure (payer-checkout: Screening explained).
function HowScreening({ inv }: { inv: CheckoutInvoice }) {
  const code = currentCode(inv.enclave);
  return (
    <details style={{ fontSize: 13, lineHeight: "19px", color: "var(--text-2)" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--text-1)" }}>How screening works</summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        <span>{TEE}. Only the verdict leaves the enclave.</span>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {CHECKS.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        {code && <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, overflowWrap: "anywhere" }}>{code}</span>}
        <Links links={[{ label: "OutLayer executions", href: OUTLAYER_EXECUTIONS }, ...(SOURCE_URL ? [{ label: "Source code", href: SOURCE_URL }] : [])]} />
      </div>
    </details>
  );
}
const MONO = { fontFamily: "var(--font-mono)", fontSize: 13 };

function useNow(ms: number) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/// The page shell: the flag stripe and the two-column card.
function Page({ left, right }: { left?: ReactNode; right: ReactNode }) {
  useEffect(() => {
    document.body.classList.add("checkout");
    return () => document.body.classList.remove("checkout");
  }, []);
  return (
    <div data-screen-label="Checkout" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", fontFamily: "var(--font-sans)", color: "var(--text-1)", background: "var(--ink-100)" }}>
      <div style={{ width: "100%", height: 4, display: "flex", flex: "none" }}>
        <span style={{ flex: 1, background: "var(--ee-blue)" }} />
        <span style={{ flex: 1, background: "#000" }} />
        <span style={{ flex: 1, background: "#fff" }} />
      </div>
      <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
        <div style={{ width: "100%", maxWidth: left ? 960 : 480, background: "var(--surface-card)", border: "1px solid var(--border-1)", borderRadius: "var(--radius-3)", boxShadow: "var(--shadow-2)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", minHeight: left ? 640 : undefined, overflow: "hidden" }}>
          {left}
          <div style={{ padding: 36, display: "flex", flexDirection: "column", gap: 28 }}>{right}</div>
        </div>
      </div>
    </div>
  );
}

const FLOW = [
  { n: "1", t: "Held in the Gateflow contract", d: "Funds arrive in a contract, not a Gateflow account." },
  { n: "2", t: "Screened in an enclave", d: "The payer is checked inside a secure enclave, usually within minutes." },
  { n: "3", t: "Released to the merchant", d: "Otherwise returned to you." },
];

function InvoiceCard({ inv, now, processing }: { inv: CheckoutInvoice; now: number; processing: boolean }) {
  const merchant = inv.merchant ?? "Merchant";
  const icon = tokenIcon(inv.symbol);
  const left = inv.expiresAtSec - now;
  const expires = `${new Date(inv.expiresAtSec * 1000).toISOString().slice(11, 16)} UTC · ${left > 0 ? `in ${timeLeft(left)}` : "expired"}`;
  const facts = [
    { k: "Invoice", v: `#${inv.id}`, s: MONO },
    ...(inv.memo ? [{ k: "Memo", v: inv.memo, s: SANS }] : []),
    processing && inv.payment ? { k: "Refund to", v: inv.payment.refundTo, s: MONO } : { k: "Expires", v: expires, s: SANS },
  ];
  return (
    <div style={{ background: "var(--ink-50)", borderRight: "1px solid var(--border-1)", padding: 36, display: "flex", flexDirection: "column", gap: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: "var(--radius-2)", background: "var(--ink-950)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }}>{initials(merchant)}</span>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{merchant}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13, color: "var(--text-2)" }}>{processing ? "Amount paid" : "Amount due"}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 40, lineHeight: "46px", fontWeight: 600, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
          {icon && <img src={icon} alt="" style={{ width: 30, height: 30, display: "block" }} />}
          {formatAmount(BigInt(inv.amount), inv.decimals)} <span style={{ fontSize: 18, fontWeight: 500, color: "var(--text-3)", letterSpacing: 0 }}>{inv.symbol}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--border-1)" }}>
        {facts.map((f) => (
          <div key={f.k} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "11px 0", borderBottom: "1px solid var(--border-1)", fontSize: 14 }}>
            <span style={{ color: "var(--text-2)" }}>{f.k}</span>
            <span style={{ ...f.s, textAlign: "right", wordBreak: "break-all" }}>{f.v}</span>
          </div>
        ))}
      </div>
      {!processing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={SECTION}>What happens to your payment</span>
          {FLOW.map((f) => (
            <div key={f.n} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-3)", width: 16, paddingTop: 2 }}>{f.n}</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{f.t}</span>
                <span style={{ fontSize: 13, lineHeight: "19px", color: "var(--text-2)" }}>{f.d}</span>
              </div>
            </div>
          ))}
          <HowScreening inv={inv} />
        </div>
      )}
      <span style={{ marginTop: "auto", fontSize: 12, color: "var(--text-3)", display: "flex", alignItems: "center", gap: 6 }}>
        Secured by <img src={logo} alt="gateflow" style={{ height: 12, display: "block" }} />
      </span>
    </div>
  );
}

/// Headline and row descriptions for the processing state.
export function headline(inv: CheckoutInvoice, steps: Step[]): Headline {
  const amount = `${formatAmount(BigInt(inv.amount), inv.decimals)} ${inv.symbol}`;
  const close = " You can close this page. Your payment continues.";
  if (inv.status === "Paid") return { badge: "Completed", tone: "done", title: "Payment complete", text: `${inv.merchant ?? "The merchant"} received ${amount}. Invoice #${inv.id} is paid.` };
  if (inv.status === "Returned") return { badge: "Returned", tone: "plain", title: "Payment returned", text: `Screening returned ${amount} to ${inv.payment?.refundTo ?? "your NEAR account"}.` };
  if (steps[0]?.label === "Returned on the origin chain") return { badge: "Returned", tone: "plain", title: "Payment returned", text: "The swap did not complete, so your deposit went back to your refund address on the origin chain." };
  if (inv.status === "Paying") return { badge: "Screening", tone: "live", title: "Checks in progress", text: `${amount} is held in the Gateflow contract while the enclave screens the payer.${close}` };
  if (steps[0]?.label === "Deposit detected" && steps[0].state === "current") return { badge: "Waiting for deposit", tone: "live", title: "Send your payment", text: `Send the exact amount below before the quote expires.${close}` };
  if (steps[0]?.label === "Deposit detected" && steps[0].state === "done") return { badge: "Deposit detected", tone: "live", title: "Payment detected", text: `Your deposit is on its way to the Gateflow contract.${close}` };
  return { badge: "Sent", tone: "live", title: "Payment sent", text: `Waiting for your transfer to reach the Gateflow contract.${close}` };
}

const DESCRIPTIONS: Record<string, (inv: CheckoutInvoice) => string> = {
  "Deposit detected": () => "Your deposit arrived on the origin chain.",
  "Returned on the origin chain": () => "Sent back to your refund address.",
  "Delivered to contract": () => "Held in the Gateflow contract.",
  "Screening in enclave": () => "The enclave checks the payer.",
  "Released to merchant": (inv) => `Paid to ${inv.merchant ?? "the merchant"}.`,
  "Returned to you": (inv) => `Sent to ${inv.payment?.refundTo ?? "your NEAR account"} on NEAR.`,
};

export function Processing({ inv, quoteStatus, details }: { inv: CheckoutInvoice; quoteStatus?: string; details?: ReactNode }) {
  const steps = timeline(inv, quoteStatus);
  const detail = screeningDetail(inv.screening, inv.status === "Paid" || inv.status === "Returned", NETWORK);
  const d = (s: Step): ReactNode =>
    s.label === "Screening in enclave" && detail ? (
      <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ wordBreak: "break-word" }}>{detail.text}</span>
        <Links links={detail.links} />
      </span>
    ) : (
      DESCRIPTIONS[s.label]?.(inv)
    );
  return <Timeline head={headline(inv, steps)} steps={steps.map((s) => ({ ...s, d: d(s) }))} details={details} />;
}

/// The export's "Pay with" tiles.
export function PayWith({ mode, onMode, children }: { mode: "wallet" | "qr"; onMode(m: "wallet" | "qr"): void; children?: ReactNode }) {
  const tile = (m: "wallet" | "qr", icon: string, title: string, sub: string) => (
    <div onClick={() => onMode(m)} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "14px 16px", borderRadius: "var(--radius-2)", cursor: "pointer", border: `1px solid ${mode === m ? "var(--ee-blue)" : "var(--border-2)"}`, boxShadow: mode === m ? "0 0 0 1px var(--ee-blue)" : "none" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600 }}>
        <Icon name={icon} size={16} />
        {title}
      </span>
      <span style={{ fontSize: 13, color: "var(--text-3)" }}>{sub}</span>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>Pay with</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
        {tile("wallet", "wallet", "Browser wallet", "Sign and pay in one step")}
        {tile("qr", "qr-code", "Address or QR", "Any wallet or exchange")}
      </div>
      {children}
    </div>
  );
}


export default function Checkout({ id }: { id: number }) {
  const [inv, setInv] = useState<CheckoutInvoice | null | undefined>();
  const [mode, setMode] = useState<"wallet" | "qr">("wallet");
  const [sent, setSent] = useState(() => wasSent(id));
  const [quote, setQuote] = useState<SavedQuote | undefined>(() => loadQuote(id));
  const [quoteStatus, setQuoteStatus] = useState<string>();
  const now = useNow(1000);

  useEffect(() => {
    let stop = false;
    const load = () =>
      api<CheckoutInvoice>("GET", `/checkout/invoice?id=${id}`).then(
        (x) => !stop && setInv(x),
        (e) => !stop && e instanceof ApiError && e.status === 404 && setInv(null),
      );
    const status = () =>
      quote &&
      api<{ status: string }>("GET", `/checkout/status?depositAddress=${encodeURIComponent(quote.depositAddress)}`).then(
        (x) => !stop && setQuoteStatus(x.status),
        () => {},
      );
    // The direct-pay tx: the relay answers 404 until the payment is opened and final, so retry until 200 or 422.
    const returned = returnedHash(location.search);
    if (returned) saveTx(id, returned);
    const report = () => {
      const txHash = loadTx(id);
      if (txHash)
        api("POST", "/checkout/tx", { invoice: id, txHash }).then(
          () => clearTx(id),
          (e) => e instanceof ApiError && e.status === 422 && clearTx(id),
        );
    };
    load();
    status();
    report();
    const t = setInterval(() => (load(), status(), report()), 5000);
    return () => ((stop = true), clearInterval(t));
  }, [id, quote]);

  if (inv === undefined) return null;
  if (inv === null) {
    return <Page right={<Message title="Invoice not found" text="Check the link with the merchant who sent it." />} />;
  }
  const blocked = unpayable(inv, now);
  const processing = inv.status !== "Open" || sent || !!quote;
  const qs = quote ? (quoteStatus ?? "PENDING_DEPOSIT") : undefined;
  const waiting = inv.status === "Open" && (qs === "PENDING_DEPOSIT" || qs === "UNKNOWN");
  const quoteExpired = !!quote && Date.parse(quote.deadline) / 1000 <= now;
  const deposit = quote && waiting && (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <DepositPanel quote={quote} now={now} />
      {quoteExpired && (
        <Button variant="secondary" size="sm" icon="rotate-cw" onClick={() => (clearQuote(id), setQuote(undefined), setQuoteStatus(undefined))}>
          Get a new quote
        </Button>
      )}
    </div>
  );
  return (
    <Page
      left={<InvoiceCard inv={inv} now={now} processing={inv.status !== "Open" || sent} />}
      right={
        processing ? (
          <Processing inv={inv} quoteStatus={qs} details={deposit || undefined} />
        ) : blocked === "expired" ? (
          <Message title="This invoice has expired" text="Ask the merchant for a new invoice." />
        ) : mode === "qr" ? (
          <CrossChainPay inv={inv} onQuote={setQuote}>
            <PayWith mode={mode} onMode={setMode}>
              <DepositPanel now={now} />
            </PayWith>
          </CrossChainPay>
        ) : (
          <>
            <PayWith mode={mode} onMode={setMode}>
              {mode === "wallet" && <NamedWarning />}
            </PayWith>
            <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
              {mode === "wallet" && <NearPayButton inv={inv} onSent={() => setSent(true)} />}
              <span style={{ fontSize: 12, lineHeight: "18px", color: "var(--text-3)", textAlign: "center" }}>{FOOTNOTE}</span>
            </div>
          </>
        )
      }
    />
  );
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ fontSize: 26, lineHeight: "32px", fontWeight: 600, letterSpacing: "-0.015em" }}>{title}</span>
      <span style={{ fontSize: 14, lineHeight: "22px", color: "var(--text-2)" }}>{text}</span>
    </div>
  );
}
