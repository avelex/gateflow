import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { Button, Input } from "../ds.jsx";
import { ed25519Supported } from "../near/key.ts";
import AuthCard from "./AuthCard.tsx";

/// The export's signed-out card, as exported.
export function SignedOut({ onSignIn }: { onSignIn: () => void }) {
  return (
    <AuthCard title="You are signed out" text="Payments keep waiting in your contracts. No decision executes without your signature.">
      <Button variant="primary" fullWidth onClick={onSignIn}>
        Sign in again
      </Button>
    </AuthCard>
  );
}

export function SignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);
  useEffect(() => void ed25519Supported().then(setSupported), []);

  if (!supported) return <AuthCard title="Sign in" text="This browser can't hold a merchant key" />;

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api("POST", "/console/session", { email });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard title="Sign in" text="Demo sign-in: email is not verified.">
      <form onSubmit={(e) => (e.preventDefault(), submit())} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Input label="Email" type="email" placeholder="you@business.com" value={email} onChange={(e) => setEmail(e.target.value)} error={error} />
        <Button variant="primary" type="submit" fullWidth disabled={busy || !email}>
          Continue
        </Button>
      </form>
    </AuthCard>
  );
}
