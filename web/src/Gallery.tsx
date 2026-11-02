// Dev-only (/?ui): every design-system component with the props the exports' markup passes it.
import type { ReactNode } from "react";
import { logo } from "./assets.ts";
import * as ds from "./ds.jsx";

const Row = ({ name, children }: { name: string; children: ReactNode }) => (
  <section style={{ display: "flex", flexDirection: "column", gap: 10, padding: "20px 0", borderBottom: "1px solid var(--border-1)" }}>
    <span className="df-label">{name}</span>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>{children}</div>
  </section>
);

export default function Gallery() {
  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px", fontFamily: "var(--font-sans)", color: "var(--text-1)" }}>
      <img src={logo} alt="gateflow" style={{ height: 22, display: "block" }} />
      <Row name="Button">
        <ds.Button variant="primary" icon="plus">New invoice</ds.Button>
        <ds.Button variant="primary" size="sm" icon="copy">Copy link</ds.Button>
        <ds.Button variant="secondary" size="sm" icon="external-link">Open checkout</ds.Button>
        <ds.Button variant="ink">Ink</ds.Button>
        <ds.Button variant="ghost" size="sm" icon="rotate-ccw">Ghost</ds.Button>
        <ds.Button variant="danger">Danger</ds.Button>
        <ds.Button variant="primary" disabled>Disabled</ds.Button>
        <div style={{ width: 320 }}><ds.Button variant="primary" fullWidth icon="wallet">Pay 0.01 BTC</ds.Button></div>
      </Row>
      <Row name="IconButton">
        <ds.IconButton icon="panel-left-close" label="Close sidebar" size="sm" />
        <ds.IconButton icon="x" label="Close" />
        <ds.IconButton icon="ellipsis" label="More" size="sm" />
      </Row>
      <Row name="Icon">
        {["wallet", "qr-code", "settings", "search", "log-out", "shield-check", "key-round", "file-text", "chevrons-up-down"].map((n) => <ds.Icon key={n} name={n} size={18} />)}
      </Row>
      <Row name="Badge">
        {(["neutral", "accent", "success", "warning", "danger", "ink"] as const).map((t) => <ds.Badge key={t} tone={t} dot>{t}</ds.Badge>)}
      </Row>
      <Row name="StatusBadge">
        {(["held", "checking", "review", "credited", "frozen", "returned", "settled"] as const).map((s) => <ds.StatusBadge key={s} status={s} />)}
      </Row>
      <Row name="Tag"><ds.Tag icon="list-checks">USDC</ds.Tag><ds.Tag onRemove={() => {}}>nBTC</ds.Tag></Row>
      <Row name="Hash">
        <ds.Hash value="bc1q8f3k2x7m9d4p0w6s5r2t1y8u3e7n4l0a9c2vz" />
        <ds.Hash value="0x4B1e9C0a7d23F5e86B02c41aD9e7F3b51C08d6A2" muted />
      </Row>
      <Row name="Stat">
        <ds.Stat label="Time to decision" value="6" unit="min" sub="median, October" />
        <ds.Stat label="Checked today" value="42" sub="payments" />
      </Row>
      <Row name="Card"><div style={{ width: 360 }}><ds.Card title="Card" meta="meta" footer="footer">Body</ds.Card></div></Row>
      <Row name="Tabs"><ds.Tabs tabs={[{ value: "all", label: "All", count: 12 }, { value: "open", label: "Open", count: 3 }, "Paid"]} defaultValue="all" /></Row>
      <Row name="Input">
        <div style={{ width: 280 }}><ds.Input label="Full legal name" placeholder="As in your ID" /></div>
        <div style={{ width: 280 }}><ds.Input mono placeholder="bc1q…" hint="Used if the swap fails" /></div>
        <div style={{ width: 280 }}><ds.Input label="Amount" error="at most 8 decimals" defaultValue="0.000000001" /></div>
      </Row>
      <Row name="Select"><div style={{ width: 280 }}><ds.Select label="Confirmations" options={["1", "3", "6"]} defaultValue="3" /></div></Row>
      <Row name="Switch · Checkbox · Radio">
        <ds.Switch label="ZEC" defaultChecked />
        <ds.Checkbox label="USDC" description="usdc.near" defaultChecked />
        <ds.Radio name="g" options={["1 hour", "24 hours", "7 days"]} defaultValue="1 hour" direction="row" />
      </Row>
      <Row name="FlowSteps">
        <div style={{ width: 640 }}><ds.FlowSteps steps={[{ title: "Delivered", text: "Payment opened" }, { title: "Screening", text: "In the enclave" }, { title: "Released" }]} current={1} /></div>
      </Row>
      <Row name="Toast · Tooltip">
        <ds.Toast tone="success" title="Invoice created">Link copied</ds.Toast>
        <ds.Toast tone="warning" title="Heads up" />
        <ds.Tooltip content="Tooltip"><span>Hover me</span></ds.Tooltip>
      </Row>
      <Row name="Dialog"><ds.Dialog inline title="Settings" footer={<ds.Button size="sm">Save</ds.Button>} onClose={() => {}}>Dialog body</ds.Dialog></Row>
    </div>
  );
}
