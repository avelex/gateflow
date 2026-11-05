// "Address or QR": pay from another chain through a 1Click quote (design decision 8).
// The export's "Sender information" block becomes the asset and refund fields; its QR panel shows the real deposit.
import QRCode from "qrcode";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "../api.ts";
import { chainIcon, chainName } from "../assets.ts";
import { Button, Hash, Icon, Input } from "../ds.jsx";
import { formatAmount, timeLeft } from "../format.ts";
import { FOOTNOTE } from "./footnote.ts";
import { chainRows, type CheckoutInvoice, feeLine, quoteFormError, type SavedQuote, saveQuote } from "./logic.ts";

export type Asset = { assetId: string; chain: string; symbol: string; decimals: number };
const LABEL = { fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" } as const;
const PANEL = { display: "flex", gap: 16, alignItems: "center", padding: "14px 16px", border: "1px solid var(--border-1)", borderRadius: "var(--radius-2)", background: "var(--ink-50)" } as const;

/// The export's QR panel: a placeholder before the quote, the deposit after.
export function DepositPanel({ quote, now, inv }: { quote?: SavedQuote; now: number; inv?: CheckoutInvoice }) {
  const fee = quote && inv && quote.decimals !== undefined ? feeLine(quote, inv, quote.decimals) : undefined;
  const [svg, setSvg] = useState<string>();
  const deadlineSec = quote && Math.floor(Date.parse(quote.deadline) / 1000);
  useEffect(() => {
    if (quote) QRCode.toString(quote.depositAddress, { type: "svg", margin: 0 }).then(setSvg, () => setSvg(undefined));
  }, [quote]);
  return (
    <div style={PANEL}>
      <div style={{ width: 96, height: 96, flex: "none", border: quote ? "1px solid var(--border-1)" : "1px dashed var(--border-2)", borderRadius: "var(--radius-2)", background: "var(--surface-card)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)", padding: quote ? 6 : 0 }}>
        {quote && svg ? <span aria-label="Deposit address QR code" style={{ width: "100%", height: "100%", display: "block" }} dangerouslySetInnerHTML={{ __html: svg }} /> : <Icon name="qr-code" size={28} />}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        {quote ? (
          <>
            <span style={LABEL}>Send exactly</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Hash value={quote.amountInFormatted ?? quote.amountIn} head={64} tail={0} />
              <span style={{ fontSize: 13, color: "var(--text-2)" }}>{quote.symbol}</span>
            </span>
            {fee && <span style={{ fontSize: 12, lineHeight: "18px", color: "var(--text-3)" }}>{fee}</span>}
            <span style={LABEL}>to</span>
            <Hash value={quote.depositAddress} head={10} tail={8} />
            {quote.depositMemo && (
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-3)" }}>
                Memo <Hash value={quote.depositMemo} head={10} tail={6} />
              </span>
            )}
            <span style={{ fontSize: 12, lineHeight: "18px", color: "var(--text-3)" }}>
              {deadlineSec !== undefined && deadlineSec > now ? `Quote expires in ${timeLeft(deadlineSec - now)}.` : "This quote has expired."}
            </span>
          </>
        ) : (
          <>
            <span style={LABEL}>Deposit address</span>
            <span style={{ fontSize: 12, lineHeight: "18px", color: "var(--text-3)" }}>Enter your refund accounts to get an address.</span>
          </>
        )}
      </div>
    </div>
  );
}

/// One network the payer can pay from: icon (or initial) and name, a check when selected.
/// A nested row is an L2 listed under its parent chain.
function ChainRow({ chain, nested, selected, onPick }: { chain: string; nested: boolean; selected: boolean; onPick(): void }) {
  const icon = chainIcon(chain);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPick}
      className="hv"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: nested ? "10px 12px 10px 24px" : "10px 12px",
        textAlign: "left",
        cursor: "pointer",
        font: "inherit",
        color: "var(--text-1)",
        background: selected ? "var(--surface-selected)" : "transparent",
        border: "none",
        borderRadius: "var(--radius-2)",
      }}
    >
      {nested && <span aria-hidden="true" style={{ width: 6, height: 6, flex: "none", borderRadius: "50%", background: "var(--ink-150)" }} />}
      {icon ? (
        <img src={icon} alt="" style={{ width: 28, height: 28, flex: "none", display: "block", borderRadius: "50%" }} />
      ) : (
        <span aria-hidden="true" style={{ width: 28, height: 28, flex: "none", borderRadius: "50%", background: "var(--ink-150)", color: "var(--text-2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600 }}>
          {chainName(chain)[0]}
        </span>
      )}
      <span style={{ fontSize: 14, fontWeight: 600 }}>{chainName(chain)}</span>
      {selected && <span style={{ marginLeft: "auto", display: "flex", color: "var(--text-1)" }}><Icon name="check" size={18} /></span>}
    </button>
  );
}

/// "Pay <symbol> from": NEAR first, then the relay's origin chains with L2s under Ethereum. `picked` is "near" or an assetId.
export function NetworkList({ symbol, assets, picked, onPick }: { symbol: string; assets: Asset[]; picked?: string; onPick(id: string): void }) {
  return (
    <div role="group" aria-label={`Pay ${symbol} from`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>Pay {symbol} from</span>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <ChainRow chain="near" nested={false} selected={picked === "near"} onPick={() => onPick("near")} />
        {chainRows(assets).map(({ asset: a, nested }) => (
          <ChainRow key={a.assetId} chain={a.chain} nested={nested} selected={a.assetId === picked} onPick={() => onPick(a.assetId)} />
        ))}
      </div>
    </div>
  );
}

/// The refund fields and the quote request for the picked origin asset. `onQuote` receives the saved quote.
export default function CrossChainPay({ inv, asset, onQuote, children }: { inv: CheckoutInvoice; asset: Asset; onQuote(q: SavedQuote): void; children?: ReactNode }) {
  const originAsset = asset.assetId;
  const [refundTo, setRefundTo] = useState("");
  const [refundOnNear, setRefundOnNear] = useState("");
  const [missing, setMissing] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const request = async () => {
    const m = quoteFormError({ originAsset, refundTo, refundOnNear });
    setMissing(m);
    if (m) return;
    setBusy(true);
    setError(undefined);
    try {
      const q = await api<SavedQuote>("POST", "/checkout/quote", { invoice: inv.id, originAsset, refundTo: refundTo.trim(), refundOnNear: refundOnNear.trim() });
      const saved: SavedQuote = { ...q, amountInFormatted: q.amountInFormatted ?? formatAmount(BigInt(q.amountIn), asset.decimals), symbol: asset.symbol, decimals: asset.decimals };
      saveQuote(inv.id, saved);
      onQuote(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14 }}>
          <Input label={`Refund address on ${chainName(asset.chain)}`} mono placeholder={asset.chain === "btc" ? "bc1q…" : asset.chain === "zec" ? "t1…" : "0x…"} value={refundTo} onChange={(e) => setRefundTo(e.target.value)} error={missing === "refundTo" ? "Enter the address that gets the swap refund" : undefined} />
          <Input label="NEAR account" mono placeholder="name.near" value={refundOnNear} onChange={(e) => setRefundOnNear(e.target.value)} error={missing === "refundOnNear" ? "Enter a NEAR account, like name.near" : undefined} />
        </div>
        <span style={{ fontSize: 12, lineHeight: "18px", color: "var(--text-3)" }}>If the swap fails, your deposit goes back to the refund address. If screening returns the payment, it goes to your NEAR account.</span>
      </div>
      {children}
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
        <Button variant="primary" fullWidth icon="qr-code" disabled={busy} onClick={request}>
          Get deposit address
        </Button>
        {error && <span style={{ fontSize: 12, lineHeight: "18px", color: "var(--red-700)", textAlign: "center" }}>{error}</span>}
        <span style={{ fontSize: 12, lineHeight: "18px", color: "var(--text-3)", textAlign: "center" }}>{FOOTNOTE}</span>
      </div>
    </>
  );
}
