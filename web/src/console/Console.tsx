// Console root: session, onboarding, then the signed-in console.
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api.ts";
import { navigate, type Route } from "../App.tsx";
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
  const load = useCallback(async () => {
    try {
      setState({ kind: "me", me: await api<Me>("GET", "/console/me") });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState({ kind: "signin" });
      else throw e;
    }
  }, []);
  useEffect(() => void load(), [load]);

  if (state.kind === "loading") return null;
  if (state.kind === "signin") return <SignIn onDone={load} onBack={() => navigate("/")} />;
  if (state.kind === "signedout") return <SignedOut onSignIn={() => setState({ kind: "signin" })} />;
  if (state.me.step !== "done") return <Onboarding me={state.me} onChange={load} />;
  return <Layout tab={tab} thread={thread} onSignOut={() => setState({ kind: "signedout" })} onUnauthorized={() => setState({ kind: "signin" })} screens={{ invoices: (p) => <Invoices {...p} />, balance: (p) => <Balance {...p} />, screening: (p) => <Screening {...p} />, settings: (p) => <Settings {...p} /> }} />;
}
