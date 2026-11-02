import { useEffect, useState } from "react";

export type Route =
  | { page: "checkout"; invoice: number }
  | { page: "console"; tab: "home" | "invoices" | "screening" }
  | { page: "redirect" };

const TABS = { "/": "home", "/invoices": "invoices", "/screening": "screening" } as const;

export function route(pathname: string): Route {
  const pay = /^\/pay\/(\d+)$/.exec(pathname);
  if (pay) return { page: "checkout", invoice: Number(pay[1]) };
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
  if (r.page === "checkout") return <div>Checkout {r.invoice}</div>;
  if (r.page === "console") return <div>Console {r.tab}</div>;
  return null;
}
