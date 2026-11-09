// Console root: session, onboarding, then the signed-in console.
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api.ts";
import { navigate, type Route } from "../App.tsx";
import { setKeyOwner } from "../near/key.ts";
import Balance from "./Balance.tsx";
import Invoices from "./Invoices.tsx";
import Layout from "./Layout.tsx";
import type { Me } from "./logic.ts";
import Onboarding from "./Onboarding.tsx";
import Screening from "./Screening.tsx";
import Settings from "./Settings.tsx";
import { SignedOut, SignIn } from "./SignIn.tsx";

type State = { kind: "loading" } | { kind: "signin" } | { kind: "signedout" } | { kind: "me"; me: Me };

export default function Console({ tab, thread }: { tab: Extract<Route, { page: "console" }>["tab"]; thread?: number }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  // The next email must not see this merchant's key mode or stored key.
  const signedOut = useCallback((kind: "signin" | "signedout") => (setKeyOwner(null), setState({ kind })), []);
  const load = useCallback(async () => {
    try {
      const me = await api<Me>("GET", "/console/me");
      setKeyOwner(me.email);
      setState({ kind: "me", me });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) signedOut("signin");
      else throw e;
    }
  }, [signedOut]);
  useEffect(() => void load(), [load]);

  if (state.kind === "loading") return null;
  if (state.kind === "signin") return <SignIn onDone={load} onBack={() => navigate("/")} />;
  if (state.kind === "signedout") return <SignedOut onSignIn={() => setState({ kind: "signin" })} />;
  if (state.me.step !== "done") return <Onboarding me={state.me} onChange={load} onSignOut={() => signedOut("signin")} />;
  return <Layout tab={tab} thread={thread} onSignOut={() => signedOut("signedout")} onUnauthorized={() => signedOut("signin")} screens={{ invoices: (p) => <Invoices {...p} />, balance: (p) => <Balance {...p} />, screening: (p) => <Screening {...p} />, settings: (p) => <Settings {...p} /> }} />;
}
