// Onboarding: one card with a live five-row timeline (design option C), in the export's "Logged out" card layout.
import { type ReactNode, useRef, useState } from "react";
import { api } from "../api.ts";
import { Button, Checkbox, Icon, Input } from "../ds.jsx";
import type { MerchantKey } from "../near/delegate.ts";
import { assertOwner, createFallbackKey, createPasskeyKey, getPasskeyKey, keyMode, NotOwner, PrfUnsupported, rememberPasskeyMode, restoreFallbackKey } from "../near/key.ts";
import AuthCard, { ERROR_STYLE } from "./AuthCard.tsx";
import { acquireKey, fuelState, keyFor, type Me, type OnboardingState, onboardingRows, onboardingScreen, type Row, type RowId, signAndRelay, type Step, TGAS } from "./logic.ts";

export const message = (e: unknown) =>
  e instanceof DOMException && e.name === "NotAllowedError" ? "Passkey prompt was cancelled" : e instanceof Error ? e.message : String(e);

const accountKey = async () => (await api<{ publicKey: string }>("GET", "/console/delegate-params")).publicKey;

export default function Onboarding({ me, onChange, onSignOut }: { me: Me; onChange: () => void; onSignOut: () => void }) {
  // The key derived or loaded earlier in this page session: retries and the gateway confirm sign with it, no new prompt.
  const held = useRef<MerchantKey>(undefined);
  const [name, setName] = useState(me.name ?? "");
  const [step, setStep] = useState<Step>(me.step);
  const [accountId, setAccountId] = useState(me.accountId ?? undefined);
  const [running, setRunning] = useState<RowId>();
  const [failed, setFailed] = useState<OnboardingState["failed"]>();
  const [fuel, setFuel] = useState<OnboardingState["fuel"]>();
  const [times, setTimes] = useState<Partial<Record<RowId, number>>>({});
  const [phrase, setPhrase] = useState<{ text: string; key: MerchantKey }>();
  const [saved, setSaved] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreText, setRestoreText] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  /// Runs one row: marks it running, records its time, and on failure pins the error to it.
  const timed = async <T,>(row: RowId, fn: () => Promise<T>): Promise<T> => {
    setRunning(row);
    setFailed(undefined);
    const t0 = Date.now();
    try {
      const v = await fn();
      setTimes((t) => ({ ...t, [row]: Date.now() - t0 }));
      return v;
    } catch (e) {
      if (e instanceof NotOwner) held.current = undefined; // the next try asks for another passkey
      setFailed({ row, error: message(e), notOwner: e instanceof NotOwner });
      throw e;
    } finally {
      setRunning(undefined);
    }
  };

  /// Passkey row: the held key, a new passkey (first step), or the device's key checked against the account.
  const passkey = () =>
    timed("passkey", async () => {
      if (held.current) return held.current;
      if (step === "account") {
        try {
          return (held.current = await createPasskeyKey(me.email));
        } catch (e) {
          if (!(e instanceof PrfUnsupported)) throw e;
          const { key, phrase } = await createFallbackKey();
          held.current = key;
          setPhrase({ text: phrase, key });
          return undefined; // continues after the phrase is saved
        }
      }
      const key = await acquireKey(keyMode());
      assertOwner(key, await accountKey());
      return (held.current = key);
    });

  /// NEAR account and Token storage rows: one backend step per call, until the gateway waits for the merchant.
  const provision = async (key: MerchantKey) => {
    let s = step;
    while (s === "account" || s === "tokens") {
      const r = await timed(s === "account" ? "account" : "tokens", () =>
        api<{ step: Step; accountId: string }>("POST", "/console/onboard", { name: name.trim(), publicKey: key.publicKey }),
      );
      s = r.step;
      setStep(s);
      setAccountId(r.accountId);
    }
  };

  const start = async () => {
    const key = await passkey();
    if (key) await provision(key);
  };

  const checkFuel = async () => {
    setFuel("checking");
    const f = fuelState(await api<{ fuelReady: boolean }>("GET", "/console/gateway").catch((e: Error) => e));
    setFuel(f);
    if (f === "ready") onChange();
  };

  /// Gateway row: the merchant's click is the consent; in PRF mode the held key signs without another prompt.
  const confirm = async () => {
    await timed("gateway", async () => {
      const key = (held.current = await keyFor(held.current, () => acquireKey(keyMode())));
      await signAndRelay(key, [{ method: "create_gateway", args: { payout_to: accountId ?? me.accountId, policy: { max_risk: 50 } }, gas: 30n * TGAS }]);
    });
    setStep("done");
    await checkFuel();
  };

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(message(e)); // rows show their own failure; the resume and phrase cards show this one
    } finally {
      setBusy(false);
    }
  };

  const signOut = () => {
    held.current = undefined;
    api("DELETE", "/console/session").finally(onSignOut);
  };
  const footer = <Footer email={me.email} onSignOut={signOut} />;
  const err = error && <span style={ERROR_STYLE}>{error}</span>;

  if (phrase) {
    return (
      <AuthCard title="Save your recovery phrase" text="This passkey cannot derive your key, so Gateflow made one in this browser. Keep the phrase somewhere safe: you need it to sign in on another device.">
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: "20px", wordBreak: "break-all", padding: 12, background: "var(--surface-sunken)", borderRadius: "var(--radius-2)" }}>
          {phrase.text}
        </div>
        <Button variant="secondary" size="sm" icon="copy" onClick={() => navigator.clipboard?.writeText(phrase.text)}>
          Copy phrase
        </Button>
        <Checkbox label="I saved it" checked={saved} onChange={setSaved} />
        <Button
          variant="primary"
          fullWidth
          disabled={!saved || busy}
          onClick={() => {
            const key = phrase.key;
            setPhrase(undefined);
            run(() => provision(key))();
          }}
        >
          Continue
        </Button>
        {err}
        {footer}
      </AuthCard>
    );
  }

  if (onboardingScreen(me.step, keyMode()) === "resume-key" && !held.current) {
    const resumeWithPasskey = async () => {
      const key = await getPasskeyKey();
      assertOwner(key, await accountKey());
      rememberPasskeyMode();
      held.current = key;
      onChange();
    };
    const resumeWithPhrase = async () => {
      held.current = await restoreFallbackKey(restoreText, me.email, await accountKey());
      onChange();
    };
    return (
      <AuthCard title="Unlock your account" text={`Use the passkey or recovery phrase you created for ${me.email}.`}>
        {restoring ? (
          <>
            <Input label="Recovery phrase" mono placeholder="ed25519:…" value={restoreText} onChange={(e) => setRestoreText(e.target.value)} />
            <Button variant="primary" fullWidth disabled={busy || !restoreText} onClick={run(resumeWithPhrase)}>
              Restore
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" fullWidth disabled={busy} onClick={run(resumeWithPasskey)}>
              Use my passkey
            </Button>
            <Button variant="secondary" fullWidth onClick={() => setRestoring(true)}>
              Enter recovery phrase
            </Button>
          </>
        )}
        {error && <span style={ERROR_STYLE}>{error === "This passkey does not own this account" ? `${error}. Your browser may list several passkeys for this email. Pick the newest one.` : error}</span>}
        {footer}
      </AuthCard>
    );
  }

  const rows = onboardingRows({ step, accountId, running, failed, fuel });
  const started = step !== "account" || running !== undefined || failed !== undefined || held.current !== undefined;
  const at = rows.findIndex((r) => r.state !== "done");
  const current = at < 0 ? undefined : rows[at];
  const head =
    current?.state === "failed" ? { text: `Setup paused at step ${at + 1} of 5`, color: "var(--red-700)" }
    : current?.state === "waiting" ? { text: `Step ${at + 1} of 5 · waiting for you`, color: "var(--amber-700)" }
    : current?.state === "running" ? { text: `Setting up · step ${at + 1} of 5`, color: "var(--blue-600)" }
    : undefined;

  const retry: Partial<Record<RowId, () => Promise<void>>> = { passkey: start, account: start, tokens: start, gateway: confirm, fuel: checkFuel };
  const action = (r: Row): ReactNode => {
    // Reloaded mid-way (or unlocked on the resume card): the first open row offers to continue.
    if (r === current && r.state === "pending" && started && (step === "account" || step === "tokens"))
      return <Button variant="primary" fullWidth disabled={busy} onClick={run(start)}>Continue setup</Button>;
    if (r.state === "waiting") return <Button variant="primary" fullWidth icon="key-round" disabled={busy} onClick={run(confirm)}>Confirm with passkey</Button>;
    if (r.state !== "failed") return null;
    const label = r.id === "fuel" ? "Check again" : failed?.notOwner ? "Try another passkey" : "Retry";
    return <Button variant="primary" fullWidth icon={r.id === "fuel" ? "refresh-cw" : "key-round"} disabled={busy} onClick={run(retry[r.id]!)}>{label}</Button>;
  };

  return (
    <AuthCard
      title={started ? name.trim() || me.name || "Your business" : "Set up your business"}
      text={
        <>
          {head && <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: head.color, marginBottom: 4 }}>{head.text}</span>}
          {!started && "Five steps, about 20 seconds. You act twice; Gateflow does the rest and pays every fee."}
        </>
      }
    >
      {!started && (
        <>
          <Input label="Business name" placeholder="Kaja Coffee" value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="primary" fullWidth icon="key-round" disabled={busy || !name.trim()} onClick={run(start)}>
            Create passkey and start
          </Button>
        </>
      )}
      <Timeline rows={rows} times={times} action={action} />
      {footer}
    </AuthCard>
  );
}

function Footer({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 8px", paddingTop: 14, borderTop: "1px solid var(--ink-150)", fontSize: 13, lineHeight: "18px", color: "var(--ink-600)" }}>
      <span>Signed in as {email}</span>
      <button type="button" onClick={onSignOut} style={{ padding: 0, border: 0, background: "none", font: "inherit", color: "var(--text-link)", cursor: "pointer" }}>
        Use another email
      </button>
    </div>
  );
}

const MARK: Record<Row["state"], { bg: string; border: string }> = {
  done: { bg: "var(--ee-blue)", border: "var(--ee-blue)" },
  running: { bg: "var(--surface-card)", border: "var(--ee-blue)" },
  waiting: { bg: "var(--surface-card)", border: "var(--ee-blue)" },
  failed: { bg: "var(--red-600)", border: "var(--red-600)" },
  pending: { bg: "var(--surface-card)", border: "var(--ink-300)" },
};

/// The checkout timeline's row markup (square markers, 2px connector) with an inline action box on the current row.
function Timeline({ rows, times, action }: { rows: Row[]; times: Partial<Record<RowId, number>>; action: (r: Row) => ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {rows.map((r, i) => {
        const done = r.state === "done";
        const muted = r.state === "pending";
        const act = action(r);
        const ms = times[r.id];
        return (
          <div key={r.id} style={{ display: "grid", gridTemplateColumns: "12px minmax(0,1fr) auto", columnGap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span style={{ width: 8, height: 8, marginTop: 6, flex: "none", background: MARK[r.state].bg, border: `2px solid ${MARK[r.state].border}` }} />
              {i < rows.length - 1 && <span style={{ flex: 1, width: 2, marginTop: 4, background: done ? "var(--ee-blue)" : "var(--ink-200)" }} />}
            </div>
            <div style={{ paddingBottom: i < rows.length - 1 ? 16 : 0, display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 14, lineHeight: "20px", fontWeight: muted ? 500 : 600, color: muted ? "var(--ink-600)" : "var(--text-1)" }}>{r.label}</span>
              {r.detail && !act && (
                <span style={{ fontSize: 13, lineHeight: "19px", color: muted ? "var(--ink-600)" : "var(--text-2)", fontFamily: r.id === "account" && done ? "var(--font-mono)" : undefined, wordBreak: "break-word" }}>
                  {r.detail}
                </span>
              )}
              {act && (
                <div
                  style={{
                    marginTop: 6,
                    padding: 14,
                    borderRadius: "var(--radius-2)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    background: r.state === "failed" ? "var(--red-50)" : "var(--surface-accent-soft)",
                    border: `1px solid ${r.state === "failed" ? "var(--red-600)" : "var(--blue-200)"}`,
                  }}
                >
                  <span role={r.state === "failed" ? "alert" : undefined} style={{ fontSize: 13, lineHeight: "19px", color: r.state === "failed" ? "var(--red-700)" : "var(--text-2)", wordBreak: "break-word" }}>
                    {r.detail}
                  </span>
                  {act}
                </div>
              )}
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: "20px", color: "var(--ink-600)" }}>
              {r.state === "running" ? (
                <span className="gf-spin" role="img" aria-label="In progress">
                  <Icon name="loader-circle" size={14} color="var(--ee-blue)" />
                </span>
              ) : done && ms !== undefined ? (
                `${Math.max(1, Math.round(ms / 1000))}s`
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
