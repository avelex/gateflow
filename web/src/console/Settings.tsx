// The export's "Settings" overlay. "Blockchains & Tokens" keeps its layout; "Gateway" replaces "Compliance BYOK" in that panel's layout.
import { type ReactNode, useEffect, useState } from "react";
import { api } from "../api.ts";
import { CHAIN_NAMES, chainIcon, chainName } from "../assets.ts";
import { Badge, Button, Checkbox, Hash, Icon, IconButton } from "../ds.jsx";
import { keyMode } from "../near/key.ts";
import Developers from "./Developers.tsx";
import type { ScreenProps } from "./Layout.tsx";
import { acquireKey, signAndRelay, TGAS } from "./logic.ts";
import { message } from "./Onboarding.tsx";

const SECTION = { fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" } as const;
const INTRO = { margin: 0, fontSize: 14, lineHeight: "22px", color: "var(--text-2)", maxWidth: 600, textWrap: "pretty" } as const;
const BOX = { border: "1px solid var(--border-1)", borderRadius: "var(--radius-2)" } as const;

/// A row in the BYOK panel's "Decision signing key" style.
function KeyRow({ icon, title, badge, sub, action }: { icon: string; title: string; badge?: ReactNode; sub: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ ...BOX, padding: "16px 20px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <span style={{ width: 36, height: 36, flex: "none", borderRadius: "var(--radius-2)", background: "var(--blue-50)", color: "var(--blue-700)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={18} />
      </span>
      <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
          {badge}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-3)" }}>{sub}</div>
      </div>
      {action}
    </div>
  );
}

function Gateway({ data, refresh, toast }: ScreenProps) {
  const current = data.gateway.policy.max_risk;
  const [risk, setRisk] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await signAndRelay(await acquireKey(keyMode()), [{ method: "set_policy", args: { gateway: data.gateway.id, policy: { max_risk: risk } }, gas: 30n * TGAS }]);
      toast("Risk tolerance saved", `Payers scoring above ${risk} are returned`);
      refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <p style={INTRO}>Your gateway receives payments into the Gateflow contract. The enclave screens each payer, then the contract releases the payment to your payout account or returns it.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={SECTION}>Payout account</span>
        <KeyRow icon="wallet" title="Payouts" badge={<Badge tone="success" dot>Active</Badge>} sub={<Hash value={data.gateway.payout_to} head={24} tail={8} muted />} />
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>Released payments go only here. Gateflow never holds your funds.</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={SECTION}>Screening fuel</span>
        <KeyRow
          icon="shield-check"
          title="Fuel"
          badge={data.gateway.fuelReady ? <Badge tone="success" dot>Ready</Badge> : <Badge tone="warning" dot>Topping up</Badge>}
          sub="Gateflow keeps your gateway funded for screening."
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={SECTION}>Risk tolerance</span>
        <div style={{ ...BOX, padding: "16px 20px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <input type="range" min={0} max={80} step={5} value={risk} onChange={(e) => setRisk(Number(e.target.value))} aria-label="Risk tolerance" style={{ flex: 1, minWidth: 200, accentColor: "var(--accent)" }} />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, width: 28, textAlign: "right" }}>{risk}</span>
          <Button variant="primary" size="sm" icon="key-round" disabled={busy || risk === current} onClick={save}>
            Save
          </Button>
        </div>
        <span style={{ fontSize: 12, color: error ? "var(--red-700)" : "var(--text-3)" }}>{error ?? "Lower is stricter. A payer whose risk score is above this value is returned. Saving asks for your passkey."}</span>
      </div>
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
            <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>{tabs.find((t) => t.k === tab)!.label}</span>
            <IconButton icon="x" label="Close" onClick={props.onClose} />
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "24px 28px 32px" }}>{tab === "gateway" ? <Gateway {...props} /> : tab === "chains" ? <Chains {...props} /> : <Developers {...props} />}</div>
        </div>
      </div>
    </div>
  );
}
