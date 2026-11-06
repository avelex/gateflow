// The export's "Settings" overlay. "Blockchains & Tokens" keeps its layout; "Gateway" replaces "Compliance BYOK" in that panel's layout.
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { CHAIN_NAMES, chainIcon, chainName } from "../assets.ts";
import { Badge, Button, Checkbox, Icon, IconButton } from "../ds.jsx";
import Developers from "./Developers.tsx";
import type { ScreenProps } from "./Layout.tsx";

const SECTION = { fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" } as const;
const INTRO = { margin: 0, fontSize: 14, lineHeight: "22px", color: "var(--text-2)", maxWidth: 600, textWrap: "pretty" } as const;
const BOX = { border: "1px solid var(--border-1)", borderRadius: "var(--radius-2)" } as const;

const TILE = { ...BOX, background: "var(--surface-card)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 6 } as const;
const TILE_VALUE = { fontSize: 19, lineHeight: "26px", fontWeight: 600 } as const;
const TILE_HINT = { fontSize: 12, lineHeight: "16px", color: "var(--text-3)" } as const;

function Gateway({ data, toast }: ScreenProps) {
  const g = data.gateway;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section aria-labelledby="payout-h" style={{ background: "var(--surface-inverse)", color: "var(--text-inverse)", borderRadius: "var(--radius-2)", padding: "24px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="wallet" size={18} />
          <span id="payout-h" style={{ ...SECTION, color: "var(--ink-300)" }}>
            Your money goes to
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span title={g.payout_to} style={{ fontFamily: "var(--font-mono)", fontSize: 22, lineHeight: "30px", fontWeight: 500, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {g.payout_to}
          </span>
          <Button variant="ink" size="sm" icon="copy" onClick={() => (navigator.clipboard?.writeText(g.payout_to), toast("Payout account copied", g.payout_to))} style={{ border: "1px solid var(--ink-700)" }}>
            Copy
          </Button>
        </div>
        <span style={{ fontSize: 13, color: "var(--ink-300)" }}>Approved payments are released straight here. Gateflow never holds your funds.</span>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
        <div style={TILE}>
          <span style={SECTION}>Screening</span>
          <span style={{ ...TILE_VALUE, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: "var(--radius-pill)", background: g.fuelReady ? "var(--success)" : "var(--warning)" }} />
            {g.fuelReady ? "Ready" : "Topping up"}
          </span>
          <span style={TILE_HINT}>Gateflow covers the NEAR cost of each check.</span>
        </div>
        <div style={TILE}>
          <span style={SECTION}>Invoices</span>
          <span style={{ ...TILE_VALUE, fontFamily: "var(--font-mono)" }}>{g.invoices}</span>
          <span style={TILE_HINT}>Created on this gateway.</span>
        </div>
        <div style={TILE}>
          <span style={SECTION}>Payments</span>
          <span style={{ ...TILE_VALUE, fontFamily: "var(--font-mono)" }}>{g.payments}</span>
          <span style={TILE_HINT}>Received and screened.</span>
        </div>
      </div>

      <details style={{ ...BOX, background: "var(--surface-card)", padding: "12px 18px" }}>
        <summary style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>How your gateway works</summary>
        <p style={{ ...INTRO, margin: "8px 0 0", fontSize: 13, lineHeight: "20px" }}>
          Payments land in the Gateflow contract. The enclave screens each payer, then the contract releases the payment to your payout account or returns it to the payer.
        </p>
      </details>
    </div>
  );
}

function Chains({ data, refresh }: ScreenProps) {
  const [origins, setOrigins] = useState<string[]>(["near"]);
  useEffect(() => {
    api<{ chain: string }[]>("GET", "/checkout/assets").then(
      (a) => setOrigins(["near", ...[...new Set(a.map((x) => x.chain))].sort((x, y) => Object.keys(CHAIN_NAMES).indexOf(x) - Object.keys(CHAIN_NAMES).indexOf(y))]),
      () => {},
    );
  }, []);
  const toggle = async (token: string, on: boolean) => {
    const off = data.tokens.filter((t) => (t.token === token ? !on : !t.enabled)).map((t) => t.token);
    await api("PUT", "/console/preferences", { tokensOff: off });
    refresh();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ ...INTRO, margin: "0 0 8px" }}>Tokens you accept on invoices, and the chains payers can pay from. Payments from other chains arrive on NEAR in your token.</p>
      <div style={BOX}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 180, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>NEAR</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-3)" }}>settlement</span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 20, alignItems: "end", padding: "14px 20px 16px", borderTop: "1px solid var(--border-1)", background: "var(--ink-50)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Tokens</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
              {data.tokens.map((t) => (
                <Checkbox key={t.token} label={t.symbol} description={t.token} checked={t.enabled} onChange={(on) => toggle(t.token, on)} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div style={BOX}>
        <div style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Payer origins</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-3)" }}>read-only</span>
        </div>
        {origins.map((c) => (
          <div key={c} style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 20px", borderTop: "1px solid var(--border-1)" }}>
            <span role="img" aria-label={chainName(c)} style={{ width: 24, height: 24, flex: "none", backgroundImage: chainIcon(c) ? `url(${chainIcon(c)})` : undefined, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" }} />
            <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{chainName(c)}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-3)" }}>{c === "near" ? "NEAR wallet" : "via NEAR Intents"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Settings(props: ScreenProps & { onClose(): void }) {
  const [tab, setTab] = useState<"gateway" | "chains" | "developers">("gateway");
  const [apiOn, setApiOn] = useState<boolean>();
  const tabs = [
    { k: "gateway" as const, label: "Gateway", icon: "key-round" },
    { k: "chains" as const, label: "Blockchains & Tokens", icon: "blocks" },
    { k: "developers" as const, label: "Developers", icon: "code" },
  ];
  return (
    <div onClick={props.onClose} style={{ position: "absolute", inset: 0, zIndex: 50, background: "rgba(10,12,16,.48)", display: "flex", justifyContent: "center", alignItems: "center", padding: 32 }}>
      <div data-screen-label="Settings" onClick={(e) => e.stopPropagation()} style={{ width: 960, maxWidth: "100%", height: 680, maxHeight: "100%", background: "var(--surface-card)", borderRadius: "var(--radius-3)", boxShadow: "var(--shadow-pop)", display: "flex", overflow: "hidden" }}>
        <div style={{ width: 220, flex: "none", background: "var(--ink-50)", borderRight: "1px solid var(--border-1)", padding: "20px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ padding: "0 10px 14px", fontSize: 19, lineHeight: "26px", fontWeight: 600, letterSpacing: "-0.01em" }}>Settings</div>
          {tabs.map((t) => (
            <div key={t.k} className="hv-ink" onClick={() => setTab(t.k)} style={{ display: "flex", alignItems: "center", gap: 10, height: 36, padding: "0 10px", borderRadius: "var(--radius-2)", cursor: "pointer", fontSize: 14, background: tab === t.k ? "var(--ink-150)" : "transparent", fontWeight: tab === t.k ? 600 : 500 }}>
              <Icon name={t.icon} size={16} />
              <span>{t.label}</span>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ height: 60, flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px 0 28px", borderBottom: "1px solid var(--border-1)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>{tabs.find((t) => t.k === tab)!.label}</span>
              {tab === "developers" && apiOn !== undefined && (
                <Badge tone={apiOn ? "success" : "neutral"} dot>
                  {apiOn ? "API enabled" : "API disabled"}
                </Badge>
              )}
            </div>
            <IconButton icon="x" label="Close" onClick={props.onClose} />
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "24px 28px 32px", background: tab === "chains" ? undefined : "var(--ink-50)" }}>{tab === "gateway" ? <Gateway {...props} /> : tab === "chains" ? <Chains {...props} /> : <Developers {...props} onEnabled={setApiOn} />}</div>
        </div>
      </div>
    </div>
  );
}
