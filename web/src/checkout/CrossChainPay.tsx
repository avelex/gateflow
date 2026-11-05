// "Address or QR": pay from another chain through a 1Click quote (design decision 8).
// The export's "Sender information" block becomes the asset and refund fields; its QR panel shows the real deposit.
import QRCode from "qrcode";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "../api.ts";
import { chainIcon, chainName } from "../assets.ts";
import { Button, Hash, Icon, Input, Select } from "../ds.jsx";
import { formatAmount, timeLeft } from "../format.ts";
import { FOOTNOTE } from "./footnote.ts";
import { type CheckoutInvoice, quoteFormError, type SavedQuote, saveQuote } from "./logic.ts";

type Asset = { assetId: string; chain: string; symbol: string; decimals: number };
const LABEL = { fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" } as const;
const PANEL = { display: "flex", gap: 16, alignItems: "center", padding: "14px 16px", border: "1px solid var(--border-1)", borderRadius: "var(--radius-2)", background: "var(--ink-50)" } as const;

/// The export's QR panel: a placeholder before the quote, the deposit after.
export function DepositPanel({ quote, now }: { quote?: SavedQuote; now: number }) {
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
            <span style={LABEL}>
              Send exactly {quote.amountInFormatted ?? quote.amountIn} {quote.symbol} to
            </span>
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
            <span style={{ fontSize: 12, lineHeight: "18px", color: "var(--text-3)" }}>Choose the token you pay with and your refund accounts to get an address.</span>
          </>
        )}
      </div>
    </div>
  );
}

/// The form fields and the quote request. `onQuote` receives the saved quote and the paying asset's symbol.
export default function CrossChainPay({ inv, onQuote, children }: { inv: CheckoutInvoice; onQuote(q: SavedQuote): void; children?: ReactNode }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [originAsset, setOriginAsset] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [refundOnNear, setRefundOnNear] = useState("");
  const [missing, setMissing] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Asset[]>("GET", "/checkout/assets").then((a) => setAssets([...a].sort((x, y) => x.chain.localeCompare(y.chain) || x.symbol.localeCompare(y.symbol))), () => setError("Could not load the tokens you can pay with."));
  }, []);
  const asset = assets.find((a) => a.assetId === originAsset);

  const request = async () => {
    const m = quoteFormError({ originAsset, refundTo, refundOnNear });
    setMissing(m);
    if (m) return;
    setBusy(true);
    setError(undefined);
    try {
      const q = await api<SavedQuote>("POST", "/checkout/quote", { invoice: inv.id, originAsset, refundTo: refundTo.trim(), refundOnNear: refundOnNear.trim() });
      const saved: SavedQuote = { ...q, amountInFormatted: q.amountInFormatted ?? formatAmount(BigInt(q.amountIn), asset!.decimals), symbol: asset!.symbol };
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
        <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>Pay from another chain</span>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Select
              label="Token you send"
              options={[{ value: "", label: "Choose a token" }, ...assets.map((a) => ({ value: a.assetId, label: `${a.symbol} · ${chainName(a.chain)}` }))]}
              value={originAsset}
              onChange={(e) => setOriginAsset(e.target.value)}
            />
          </div>
          {asset && chainIcon(asset.chain) && <img src={chainIcon(asset.chain)} alt="" style={{ width: 24, height: 24, marginBottom: 6, display: "block" }} />}
        </div>
        {missing === "originAsset" && <span style={{ fontSize: 12, color: "var(--red-700)", marginTop: -8 }}>Choose the token you send.</span>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14 }}>
          <Input label={asset ? `Refund address on ${chainName(asset.chain)}` : "Refund address"} mono placeholder={asset?.chain === "btc" ? "bc1q…" : asset?.chain === "zec" ? "t1…" : "0x…"} value={refundTo} onChange={(e) => setRefundTo(e.target.value)} error={missing === "refundTo" ? "Enter the address that gets the swap refund" : undefined} />
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
