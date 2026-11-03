// Onboarding (design decision 6), in the export's "Logged out" card layout.
import { useState } from "react";
import { api } from "../api.ts";
import { Button, Checkbox, Input } from "../ds.jsx";
import type { MerchantKey } from "../near/delegate.ts";
import { assertOwner, createFallbackKey, createPasskeyKey, getPasskeyKey, keyMode, PrfUnsupported, rememberPasskeyMode, restoreFallbackKey } from "../near/key.ts";
import AuthCard, { ERROR_STYLE } from "./AuthCard.tsx";
import { acquireKey, type Me, onboardingScreen, signAndRelay, TGAS } from "./logic.ts";

export const message = (e: unknown) =>
  e instanceof DOMException && e.name === "NotAllowedError" ? "Passkey prompt was cancelled" : e instanceof Error ? e.message : String(e);

export default function Onboarding({ me, onChange }: { me: Me; onChange: () => void }) {
  const [name, setName] = useState(me.name ?? "");
  const [phrase, setPhrase] = useState<{ text: string; key: MerchantKey }>();
  const [saved, setSaved] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreText, setRestoreText] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

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

  const onboard = async (key: MerchantKey) => {
    await api("POST", "/console/onboard", { name: name.trim(), publicKey: key.publicKey });
    onChange();
  };

  const accountKey = async () => (await api<{ publicKey: string }>("GET", "/console/delegate-params")).publicKey;
  // The device's key mode changes only after the key is checked against the account.
  const resumeWithPasskey = async () => {
    assertOwner(await getPasskeyKey(), await accountKey());
    rememberPasskeyMode();
    onChange();
  };
  const resumeWithPhrase = async () => {
    await restoreFallbackKey(restoreText, me.email, await accountKey());
    onChange();
  };

  const err = error && <span style={ERROR_STYLE}>{error}</span>;
  const screen = onboardingScreen(me.step, keyMode());

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
        <Button variant="primary" fullWidth disabled={!saved || busy} onClick={() => run(async () => (await onboard(phrase.key), setPhrase(undefined)))}>
          Continue
        </Button>
        {err}
      </AuthCard>
    );
  }

  if (screen === "resume-key") {
    return (
      <AuthCard title="Unlock your account" text={`Use the passkey or recovery phrase you created for ${me.email}.`}>
        {restoring ? (
          <>
            <Input label="Recovery phrase" mono placeholder="ed25519:…" value={restoreText} onChange={(e) => setRestoreText(e.target.value)} />
            <Button variant="primary" fullWidth disabled={busy || !restoreText} onClick={() => run(resumeWithPhrase)}>
              Restore
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" fullWidth disabled={busy} onClick={() => run(resumeWithPasskey)}>
              Use my passkey
            </Button>
            <Button variant="secondary" fullWidth onClick={() => setRestoring(true)}>
              Enter recovery phrase
            </Button>
          </>
        )}
        {err}
      </AuthCard>
    );
  }

  if (screen === "gateway") {
    // The relay registered the merchant's own account on every token.
    const payoutTo = me.accountId!;
    return (
      <AuthCard title="Confirm your gateway" text={`Paid invoices settle to ${payoutTo}. One passkey prompt confirms it; Gateflow covers the setup costs.`}>
        <Button
          variant="primary"
          fullWidth
          icon="key-round"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const key = await acquireKey(keyMode());
              await signAndRelay(key, [{ method: "create_gateway", args: { payout_to: payoutTo, policy: { max_risk: 50 } }, gas: 30n * TGAS }]);
              onChange();
            })
          }
        >
          Confirm with passkey
        </Button>
        {err}
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Set up your business" text={`Signed in as ${me.email}. Demo sign-in: email is not verified.`}>
      <Input label="Business name" placeholder="Kaja Coffee" value={name} onChange={(e) => setName(e.target.value)} />
      <Button
        variant="primary"
        fullWidth
        icon="key-round"
        disabled={busy || !name.trim()}
        onClick={() =>
          run(async () => {
            if (me.step !== "account") return onboard(await acquireKey(keyMode()));
            try {
              await onboard(await createPasskeyKey(me.email));
            } catch (e) {
              if (!(e instanceof PrfUnsupported)) throw e;
              const { key, phrase } = await createFallbackKey();
              setPhrase({ text: phrase, key });
            }
          })
        }
      >
        {me.step === "account" ? "Create passkey and continue" : "Continue"}
      </Button>
      {err}
    </AuthCard>
  );
}
