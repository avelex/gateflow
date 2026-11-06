import { useEffect, useState } from "react";
import Checkout from "./checkout/Checkout.tsx";
import Console from "./console/Console.tsx";
import Landing from "./landing/Landing.tsx";

export type Route =
  | { page: "landing" }
  | { page: "checkout"; invoice: number }
  | { page: "console"; tab: "home" | "invoices" | "balance" | "screening" | "chat"; thread?: number }
  | { page: "redirect" };

const TABS = { "/console": "home", "/console/invoices": "invoices", "/console/balance": "balance", "/console/screening": "screening" } as const;

export function route(pathname: string): Route {
  if (pathname === "/") return { page: "landing" };
  const pay = /^\/pay\/(\d+)$/.exec(pathname);
  if (pay) return { page: "checkout", invoice: Number(pay[1]) };
  const chat = /^\/console\/chat(?:\/(\d+))?$/.exec(pathname);
  if (chat) return chat[1] ? { page: "console", tab: "chat", thread: Number(chat[1]) } : { page: "console", tab: "chat" };
  const tab = TABS[pathname as keyof typeof TABS];
  return tab ? { page: "console", tab } : { page: "redirect" };
}

export function navigate(path: string): void {
  history.pushState(null, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
}

function usePathname(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  return path;
}

export default function App() {
  const r = route(usePathname());
  useEffect(() => {
    if (r.page === "redirect") history.replaceState(null, "", "/"), dispatchEvent(new PopStateEvent("popstate"));
  }, [r.page]);
  if (r.page === "landing") return <Landing onLaunch={() => navigate("/console")} />;
  if (r.page === "checkout") return <Checkout id={r.invoice} />;
  if (r.page === "console") return <Console tab={r.tab} thread={r.thread} />;
  return null;
}
