// Settings > Developers: enable the merchant API, API keys, webhook, allowed origins and integration snippets.
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import { Badge, Button, Input } from "../ds.jsx";
import { keyMode } from "../near/key.ts";
import type { ScreenProps } from "./Layout.tsx";
import { acquireKey, type Dev, enableAction, signKeyAction, snippets } from "./logic.ts";
import { message } from "./Onboarding.tsx";

const SECTION = { fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" } as const;
const INTRO = { margin: 0, fontSize: 14, lineHeight: "22px", color: "var(--text-2)", maxWidth: 600, textWrap: "pretty" } as const;
const BOX = { border: "1px solid var(--border-1)", borderRadius: "var(--radius-2)" } as const;
const HINT = { fontSize: 12, color: "var(--text-3)" } as const;
const MONO = { fontFamily: "var(--font-mono)", fontSize: 12 } as const;

type ApiKey = { id: string; label: string; last4: string; createdAt: number };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={SECTION}>{title}</span>
      {children}
    </div>
  );
}

/// A secret shown once, with a copy action.
function Secret({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ ...BOX, padding: "12px 16px", background: "var(--amber-50, var(--ink-50))", display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <code style={{ ...MONO, flex: 1, minWidth: 200, wordBreak: "break-all" }}>{value}</code>
        <Button variant="secondary" size="sm" icon="copy" onClick={() => navigator.clipboard?.writeText(value)}>
          Copy
        </Button>
      </div>
      <span style={HINT}>Store it now. Gateflow does not show it again.</span>
    </div>
  );
}

function Snippet({ title, code }: { title: string; code: string }) {
  return (
    <div style={{ ...BOX, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px 8px 16px", background: "var(--ink-50)", borderBottom: "1px solid var(--border-1)" }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        <Button variant="ghost" size="sm" icon="copy" onClick={() => navigator.clipboard?.writeText(code)}>
          Copy
        </Button>
      </div>
      <pre style={{ ...MONO, margin: 0, padding: "12px 16px", overflowX: "auto", lineHeight: "18px" }}>{code}</pre>
    </div>
  );
}

export default function Developers({ toast }: ScreenProps) {
  const [dev, setDev] = useState<Dev>();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [label, setLabel] = useState("");
  const [newKey, setNewKey] = useState<string>();
  const [hook, setHook] = useState("");
  const [secret, setSecret] = useState<string>();
  const [origins, setOrigins] = useState("");

  const load = useCallback(async () => {
    const d = await api<Dev>("GET", "/console/dev");
    setDev(d);
    setHook(d.webhookUrl ?? "");
    setOrigins(d.origins.join("\n"));
    if (d.enabled) setKeys(await api<ApiKey[]>("GET", "/console/api-keys"));
  }, []);
  useEffect(() => {
    load().catch((e) => setError(message(e)));
  }, [load]);

  /// Runs `fn` with the busy flag, showing its error under the section.
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  if (!dev) return error ? <span style={{ ...HINT, color: "var(--red-700)" }}>{error}</span> : null;
  if (!dev.available) return <p style={INTRO}>The merchant API is not available on this Gateflow server.</p>;
  const errorLine = error && <span style={{ ...HINT, color: "var(--red-700)" }}>{error}</span>;

  if (!dev.enabled)
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p style={INTRO}>
          Let your shop's server create invoices for each order and receive payment updates. Enabling allows Gateflow to create invoices on your gateway, and nothing else. Payments still go only to your payout account. Enabling asks for your passkey.
        </p>
        <div>
          <Button
            variant="primary"
            icon="key-round"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await signKeyAction(await acquireKey(keyMode()), enableAction(dev));
                toast("API enabled", "Create an API key for your shop");
                await load();
              })
            }
          >
            Enable API
          </Button>
        </div>
        {errorLine}
      </div>
    );

  const origin = location.origin;
  const { curl, widget } = snippets(origin);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <p style={INTRO}>Your shop's server creates invoices with an API key. The checkout opens on your page with one script tag, and the webhook tells your server when an order is paid.</p>
      {errorLine}

      <Section title="API keys">
        {newKey && <Secret label="New API key" value={newKey} />}
        <div style={BOX}>
          {keys.length === 0 && <div style={{ padding: "14px 20px", ...HINT }}>No keys yet.</div>}
          {keys.map((k, i) => (
            <div key={k.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderTop: i ? "1px solid var(--border-1)" : undefined }}>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{k.label}</span>
              <span style={{ ...MONO, color: "var(--text-3)" }}>…{k.last4}</span>
              <span style={HINT}>{new Date(k.createdAt).toISOString().slice(0, 10)}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api("DELETE", `/console/api-keys?id=${k.id}`);
                    toast("API key revoked", k.label);
                    await load();
                  })
                }
              >
                Revoke
              </Button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Input label="Label" placeholder="Shop server" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <Button
            variant="secondary"
            icon="plus"
            disabled={busy || !label.trim()}
            onClick={() =>
              run(async () => {
                setNewKey((await api<{ key: string }>("POST", "/console/api-keys", { label: label.trim() })).key);
                setLabel("");
                await load();
              })
            }
          >
            Create key
          </Button>
        </div>
      </Section>

      <Section title="Webhook">
        {secret && <Secret label="Webhook signing secret" value={secret} />}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <Input label="URL" placeholder="https://shop.example/gateflow/webhook" value={hook} onChange={(e) => setHook(e.target.value)} mono />
          </div>
          <Button
            variant="secondary"
            disabled={busy || !hook.trim() || hook.trim() === dev.webhookUrl}
            onClick={() =>
              run(async () => {
                setSecret((await api<{ secret: string }>("PUT", "/console/webhook", { url: hook.trim() })).secret);
                await load();
              })
            }
          >
            Save
          </Button>
          {dev.webhookUrl && (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => run(async () => setSecret((await api<{ secret: string }>("POST", "/console/webhook/secret")).secret))}>
                Roll secret
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api("PUT", "/console/webhook", { url: null });
                    setSecret(undefined);
                    await load();
                  })
                }
              >
                Remove
              </Button>
            </>
          )}
        </div>
        <span style={HINT}>Events: invoice.paying, invoice.paid, invoice.returned, invoice.expired. Each request is signed in the Gateflow-Signature header.</span>
      </Section>

      <Section title="Allowed origins">
        <textarea
          aria-label="Allowed origins"
          rows={3}
          placeholder="https://shop.example"
          value={origins}
          onChange={(e) => setOrigins(e.target.value)}
          style={{ ...BOX, ...MONO, padding: "10px 12px", resize: "vertical", background: "var(--surface-card)", color: "var(--text-1)" }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const list = origins.split(/\s+/).filter(Boolean);
                await api("PUT", "/console/origins", { origins: list });
                toast("Allowed origins saved");
                await load();
              })
            }
          >
            Save
          </Button>
          <span style={HINT}>One per line. Only these sites receive checkout status and can be returned to after payment.</span>
        </div>
      </Section>

      <Section title="Integrate">
        <Snippet title="Create an invoice (server)" code={curl} />
        <Snippet title="Open the checkout (page)" code={widget} />
      </Section>

      <Section title="API access">
        <div style={{ ...BOX, padding: "14px 20px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <Badge tone="success" dot>
            Enabled
          </Badge>
          <span style={{ flex: 1, minWidth: 200, ...HINT }}>Disabling stops all API keys from creating invoices. It asks for your passkey.</span>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await signKeyAction(await acquireKey(keyMode()), { deleteKey: dev.signerPublicKey! });
                setNewKey(undefined);
                setSecret(undefined);
                toast("API disabled");
                await load();
              })
            }
          >
            Disable API
          </Button>
        </div>
      </Section>
    </div>
  );
}
