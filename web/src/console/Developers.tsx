// Settings > Developers: enable the merchant API, API keys, webhook, allowed origins and integration snippets.
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import { Button, Card, IconButton, Input, Tabs, Tag } from "../ds.jsx";
import { keyMode } from "../near/key.ts";
import type { ScreenProps } from "./Layout.tsx";
import { acquireKey, type CodeToken, type Dev, enableAction, highlight, signKeyAction, snippets } from "./logic.ts";
import { message } from "./Onboarding.tsx";

const SECTION = { fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" } as const;
const INTRO = { margin: 0, fontSize: 14, lineHeight: "22px", color: "var(--text-2)", maxWidth: 600, textWrap: "pretty" } as const;
const BOX = { border: "1px solid var(--border-1)", borderRadius: "var(--radius-2)" } as const;
const HINT = { fontSize: 12, color: "var(--text-3)" } as const;
const MONO = { fontFamily: "var(--font-mono)", fontSize: 12 } as const;
const CARD = { ...BOX, background: "var(--surface-card)" } as const;
const KEY_ROW = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 110px 100px 80px", alignItems: "center", gap: 12 } as const;
const EVENT = { ...MONO, fontSize: 11, lineHeight: "22px", padding: "0 8px", borderRadius: "var(--radius-pill)", background: "var(--surface-accent-soft)", color: "var(--blue-700)" } as const;
const CODE_COLOR: Record<NonNullable<CodeToken["kind"]>, string> = { comment: "var(--ink-400)", string: "var(--blue-200)", tag: "var(--blue-300)", flag: "var(--white)", keyword: "var(--blue-300)" };
const EVENTS = ["invoice.paying", "invoice.paid", "invoice.returned", "invoice.expired"];

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

/// `onEnabled` reports whether the merchant API is on, for the Settings header.
export default function Developers({ toast, onEnabled }: ScreenProps & { onEnabled?(on: boolean): void }) {
  const [dev, setDev] = useState<Dev>();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [label, setLabel] = useState("");
  const [newKey, setNewKey] = useState<string>();
  const [hook, setHook] = useState("");
  const [secret, setSecret] = useState<string>();
  const [addingKey, setAddingKey] = useState(false);
  const [editHook, setEditHook] = useState(false);
  const [originDraft, setOriginDraft] = useState("");
  const [snip, setSnip] = useState<"curl" | "widget">("curl");

  const load = useCallback(async () => {
    const d = await api<Dev>("GET", "/console/dev");
    setDev(d);
    onEnabled?.(d.available && d.enabled);
    setHook(d.webhookUrl ?? "");
    if (d.enabled) setKeys(await api<ApiKey[]>("GET", "/console/api-keys"));
  }, [onEnabled]);
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
  const code = snip === "curl" ? curl : widget;
  const editingHook = !dev.webhookUrl || editHook;
  const saveOrigins = (list: string[]) =>
    run(async () => {
      await api("PUT", "/console/origins", { origins: list });
      setOriginDraft("");
      toast("Allowed origins saved");
      await load();
    });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {errorLine}

      <div style={{ ...CARD, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={SECTION}>API base</span>
        <code style={{ ...MONO, fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{origin}/api/v1</code>
        <IconButton icon="copy" label="Copy API base URL" size="sm" onClick={() => navigator.clipboard?.writeText(`${origin}/api/v1`)} />
      </div>

      <Card
        title="API keys"
        padding={0}
        actions={
          !addingKey && (
            <Button variant="secondary" size="sm" icon="plus" onClick={() => setAddingKey(true)}>
              New key
            </Button>
          )
        }
      >
        {newKey && (
          <div style={{ padding: "12px 20px 0" }}>
            <Secret label="New API key" value={newKey} />
          </div>
        )}
        {addingKey && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", padding: "12px 20px", borderBottom: "1px solid var(--border-1)" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <Input label="Label" placeholder="Shop server" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <Button
              variant="primary"
              disabled={busy || !label.trim()}
              onClick={() =>
                run(async () => {
                  setNewKey((await api<{ key: string }>("POST", "/console/api-keys", { label: label.trim() })).key);
                  setLabel("");
                  setAddingKey(false);
                  await load();
                })
              }
            >
              Create key
            </Button>
            <Button variant="ghost" onClick={() => (setAddingKey(false), setLabel(""))}>
              Cancel
            </Button>
          </div>
        )}
        {keys.length === 0 && <div style={{ padding: "14px 20px", ...HINT }}>No keys yet. Your server sends one in the Authorization header.</div>}
        {keys.length > 0 && (
          <div style={{ ...KEY_ROW, padding: "8px 20px", borderBottom: "1px solid var(--border-1)" }}>
            <span style={SECTION}>Label</span>
            <span style={SECTION}>Key</span>
            <span style={SECTION}>Created</span>
            <span />
          </div>
        )}
        {keys.map((k, i) => (
          <div key={k.id} style={{ ...KEY_ROW, padding: "6px 20px", borderTop: i ? "1px solid var(--border-1)" : undefined }}>
            <span style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>{k.label}</span>
            <span style={{ ...MONO, color: "var(--text-3)" }}>…{k.last4}</span>
            <span style={HINT}>{new Date(k.createdAt).toISOString().slice(0, 10)}</span>
            <div style={{ justifySelf: "end" }}>
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
          </div>
        ))}
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        <Card
          title="Webhook"
          padding="14px 20px"
          actions={
            dev.webhookUrl && (
              <>
                {!editHook && (
                  <Button variant="ghost" size="sm" onClick={() => setEditHook(true)}>
                    Edit
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api("PUT", "/console/webhook", { url: null });
                      setSecret(undefined);
                      setEditHook(false);
                      await load();
                    })
                  }
                >
                  Remove
                </Button>
              </>
            )
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {secret && <Secret label="Webhook signing secret" value={secret} />}
            {editingHook ? (
              <>
                <Input label="URL" placeholder="https://shop.example/gateflow/webhook" value={hook} onChange={(e) => setHook(e.target.value)} mono />
                <div style={{ display: "flex", gap: 8 }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy || !hook.trim() || hook.trim() === dev.webhookUrl}
                    onClick={() =>
                      run(async () => {
                        setSecret((await api<{ secret: string }>("PUT", "/console/webhook", { url: hook.trim() })).secret);
                        setEditHook(false);
                        await load();
                      })
                    }
                  >
                    Save
                  </Button>
                  {dev.webhookUrl && (
                    <Button variant="ghost" size="sm" onClick={() => (setEditHook(false), setHook(dev.webhookUrl ?? ""))}>
                      Cancel
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <code style={{ ...MONO, lineHeight: "18px", padding: "8px 10px", background: "var(--surface-sunken)", borderRadius: "var(--radius-2)", wordBreak: "break-all" }}>{dev.webhookUrl}</code>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {EVENTS.map((e) => (
                <span key={e} style={EVENT}>
                  {e}
                </span>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
              <span style={{ ...HINT, flex: 1, minWidth: 140 }}>
                Signed in <code style={{ ...MONO, fontSize: 11 }}>Gateflow-Signature</code>
              </span>
              {dev.webhookUrl && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(async () => setSecret((await api<{ secret: string }>("POST", "/console/webhook/secret")).secret))}>
                  Roll secret
                </Button>
              )}
            </div>
          </div>
        </Card>

        <Card title="Allowed origins" padding="14px 20px">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {dev.origins.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {dev.origins.map((o) => (
                  <Tag key={o} onRemove={busy ? undefined : () => saveOrigins(dev.origins.filter((x) => x !== o))}>
                    <span style={MONO}>{o}</span>
                  </Tag>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Input label="Add origin" placeholder="https://shop.example" value={originDraft} onChange={(e) => setOriginDraft(e.target.value)} mono />
              </div>
              <Button
                variant="secondary"
                disabled={busy || !originDraft.trim() || dev.origins.includes(originDraft.trim())}
                onClick={() => saveOrigins([...dev.origins, originDraft.trim()])}
              >
                Add
              </Button>
            </div>
            <span style={HINT}>Only these sites receive checkout status and can be returned to after payment.</span>
          </div>
        </Card>
      </div>

      <Card
        title="Integrate"
        padding={0}
        actions={
          <Button variant="ghost" size="sm" icon="copy" onClick={() => navigator.clipboard?.writeText(code)}>
            Copy
          </Button>
        }
      >
        <div style={{ padding: "0 20px" }}>
          <Tabs
            tabs={[
              { value: "curl", label: "Server · create an invoice" },
              { value: "widget", label: "Page · open the checkout" },
            ]}
            value={snip}
            onChange={(v) => setSnip(v as typeof snip)}
          />
        </div>
        <pre style={{ ...MONO, margin: 0, padding: "14px 20px", overflowX: "auto", lineHeight: "19px", background: "var(--ink-900)", color: "var(--ink-200)", borderRadius: "0 0 var(--radius-2) var(--radius-2)" }}>
          {highlight(code).map((t, i) => (t.kind ? <span key={i} style={{ color: CODE_COLOR[t.kind], fontStyle: t.kind === "comment" ? "italic" : undefined }}>{t.text}</span> : t.text))}
        </pre>
      </Card>

      <div style={{ ...CARD, borderColor: "var(--red-50)", padding: "12px 20px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span style={{ flex: 1, minWidth: 200, fontSize: 13, color: "var(--text-2)" }}>Disable the API. Every key stops creating invoices. Asks for your passkey.</span>
        <Button
          variant="danger"
          size="sm"
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
    </div>
  );
}
