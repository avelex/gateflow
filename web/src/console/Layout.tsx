// The export's "Sidebar" and "Profile menu" (design/Gateflow Console.html) around the console screens.
import { type ReactNode, useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { navigate, type Route } from "../App.tsx";
import { logo } from "../assets.ts";
import { Icon, IconButton, Toast } from "../ds.jsx";
import { initials } from "../format.ts";
import Chat from "./Chat.tsx";
import Home from "./Home.tsx";
import type { Invoice, Me, Payment, Thread } from "./logic.ts";
import Search from "./Search.tsx";
import { usePoll } from "./usePoll.ts";

export type Gateway = { id: number; owner: string; payout_to: string; policy: { max_risk: number }; fuel: string; fuelReady: boolean; invoices: number; payments: number };
export type Token = { token: string; symbol: string; decimals: number; enabled: boolean };
export type ConsoleData = { me: Me; gateway: Gateway; invoices: Invoice[]; payments: Payment[]; tokens: Token[]; threads: Thread[] };
export type Tab = Extract<Route, { page: "console" }>["tab"];
/// What every console screen receives.
export type ScreenProps = { data: ConsoleData; refresh(): void; toast(title: string, body?: string): void };

const load = async (): Promise<ConsoleData> => {
  const [me, gateway, invoices, payments, tokens, threads] = await Promise.all([
    api<Me>("GET", "/console/me"),
    api<Gateway>("GET", "/console/gateway"),
    api<Invoice[]>("GET", "/console/invoices"),
    api<Payment[]>("GET", "/console/payments"),
    api<Token[]>("GET", "/console/tokens"),
    api<Thread[]>("GET", "/console/threads"),
  ]);
  return { me, gateway, invoices, payments, tokens, threads };
};

export default function Layout({
  tab,
  thread,
  onSignOut,
  onUnauthorized,
  screens,
}: {
  tab: Tab;
  thread?: number;
  onSignOut(): void;
  onUnauthorized(): void;
  screens: Partial<Record<Exclude<Tab, "home" | "chat">, (p: ScreenProps) => ReactNode>> & { settings?: (p: ScreenProps & { onClose(): void }) => ReactNode };
}) {
  const { data, error, refresh } = usePoll(load, 15000);
  const [side, setSide] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<{ title: string; body?: string }>();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showToast = (title: string, body?: string) => {
    setToast({ title, body });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), 2600);
  };

  useEffect(() => {
    if (error?.status === 401) onUnauthorized();
  }, [error, onUnauthorized]);

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") (e.preventDefault(), setSearchOpen(true));
      if (mod && e.key.toLowerCase() === "b") (e.preventDefault(), setSide((s) => !s), setProfileOpen(false));
      if (e.key === "Escape") (setSearchOpen(false), setSettingsOpen(false), setProfileOpen(false));
    };
    addEventListener("keydown", kd);
    return () => removeEventListener("keydown", kd);
  }, []);

  if (!data) return null;
  const pending = data.payments.filter((p) => p.status === "Pending").length;
  const name = data.me.name ?? data.me.email;
  const nav = [
    { label: "Home", icon: "house", key: "home", onClick: () => navigate("/") },
    { label: "Search", icon: "search", kbd: "⌘K", key: "search", onClick: () => setSearchOpen(true) },
    { label: "Invoices", icon: "file-text", key: "invoices", onClick: () => navigate("/invoices") },
    { label: "Screening", icon: "shield-check", key: "screening", count: pending || null, onClick: () => navigate("/screening") },
  ].map((n) => ({
    ...n,
    kbd: side ? n.kbd : null,
    count: side ? n.count : null,
    dot: !side && !!n.count,
    bg: tab === n.key ? "var(--ink-150)" : "transparent",
    fw: tab === n.key ? 600 : 500,
  }));
  const navPad = side ? "12px" : "10px";
  const props = { data, refresh, toast: showToast };

  return (
    <div style={{ display: "flex", height: "100vh", minHeight: 640, background: "var(--surface-page)", fontFamily: "var(--font-sans)", color: "var(--text-1)", overflow: "hidden", position: "relative" }}>
      <aside data-screen-label="Sidebar" style={{ width: side ? "256px" : "60px", transition: "width var(--dur-base) var(--ease-standard)", flex: "none", display: "flex", flexDirection: "column", background: "var(--surface-card)", borderRight: "1px solid var(--border-1)", position: "relative" }}>
        <div style={{ height: 4, display: "flex", flex: "none" }}>
          <span style={{ flex: 1, background: "var(--ee-blue)" }} />
          <span style={{ flex: 1, background: "#000" }} />
          <span style={{ flex: 1, background: "#fff" }} />
        </div>
        {side ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 12px 14px 20px" }}>
            <img src={logo} alt="gateflow" style={{ height: 22, display: "block" }} />
            <IconButton icon="panel-left-close" label="Close sidebar" size="sm" onClick={() => (setSide(false), setProfileOpen(false))} />
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "center", padding: "14px 0" }}>
            <IconButton icon="panel-left-open" label="Open sidebar" size="sm" onClick={() => setSide(true)} />
          </div>
        )}
        <nav style={{ display: "flex", flexDirection: "column", gap: 2, padding: `0 ${navPad}` }}>
          {nav.map((it) => (
            <div key={it.key} className="hv" onClick={it.onClick} title={it.label} style={{ display: "flex", alignItems: "center", gap: 10, height: 36, padding: "0 10px", borderRadius: "var(--radius-2)", cursor: "pointer", fontSize: 14, color: "var(--text-1)", background: it.bg, fontWeight: it.fw, position: "relative" }}>
              <Icon name={it.icon} size={16} />
              {it.dot && <span style={{ position: "absolute", top: 7, right: 7, width: 6, height: 6, background: "var(--amber-600)" }} />}
              {side && <span style={{ flex: 1, whiteSpace: "nowrap" }}>{it.label}</span>}
              {it.kbd && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)" }}>{it.kbd}</span>}
              {it.count && <span style={{ fontSize: 11, fontWeight: 700, background: "var(--amber-50)", color: "var(--amber-700)", padding: "1px 6px", borderRadius: "var(--radius-1)" }}>{it.count}</span>}
            </div>
          ))}
        </nav>
        {side ? (
          <>
            <div style={{ padding: "24px 22px 8px", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" }}>Recents</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "0 12px", overflow: "auto", flex: 1, minHeight: 0 }}>
              {data.threads.slice(0, 20).map((t) => (
                <div key={t.id} className="hv" onClick={() => navigate(`/chat/${t.id}`)} title={t.title} style={{ padding: "7px 10px", borderRadius: "var(--radius-2)", fontSize: 13, lineHeight: "18px", color: "var(--text-2)", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", background: tab === "chat" && thread === t.id ? "var(--ink-150)" : "transparent" }}>
                  {t.title}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ flex: 1 }} />
        )}
        <div style={{ borderTop: "1px solid var(--border-1)", padding: `10px ${navPad}`, position: "relative" }}>
          <div className="hv" onClick={() => setProfileOpen((o) => !o)} title={name} style={{ display: "flex", alignItems: "center", gap: 10, padding: side ? "8px" : "4px 5px", borderRadius: "var(--radius-2)", cursor: "pointer" }}>
            <span style={{ width: 30, height: 30, flex: "none", borderRadius: "var(--radius-2)", background: "var(--ink-950)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }}>{initials(name)}</span>
            {side && (
              <>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
                  <span style={{ fontSize: 12, color: "var(--text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{data.me.email}</span>
                </span>
                <Icon name="chevrons-up-down" size={16} />
              </>
            )}
          </div>
        </div>
        {profileOpen && (
          <>
            <div onClick={() => setProfileOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
            <div data-screen-label="Profile menu" style={{ position: "absolute", left: 12, width: 232, bottom: 70, zIndex: 41, background: "var(--surface-card)", borderRadius: "var(--radius-3)", boxShadow: "var(--shadow-pop)", padding: 6 }}>
              <div style={{ padding: "10px 10px 12px", borderBottom: "1px solid var(--border-1)", marginBottom: 6, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{data.me.email}</span>
              </div>
              <div className="hv" onClick={() => (setProfileOpen(false), setSettingsOpen(true))} style={{ display: "flex", alignItems: "center", gap: 10, height: 36, padding: "0 10px", borderRadius: "var(--radius-2)", cursor: "pointer", fontSize: 14 }}>
                <Icon name="settings" size={16} />
                <span>Settings</span>
              </div>
              <div className="hv" onClick={() => (setProfileOpen(false), api("DELETE", "/console/session").finally(onSignOut))} style={{ display: "flex", alignItems: "center", gap: 10, height: 36, padding: "0 10px", borderRadius: "var(--radius-2)", cursor: "pointer", fontSize: 14 }}>
                <Icon name="log-out" size={16} />
                <span>Sign out</span>
              </div>
            </div>
          </>
        )}
      </aside>

      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", position: "relative" }}>
        {tab === "home" ? <Home {...props} /> : tab === "chat" ? <Chat {...props} thread={thread} /> : screens[tab]?.(props)}
      </main>

      {searchOpen && <Search data={data} onClose={() => setSearchOpen(false)} />}
      {settingsOpen && screens.settings?.({ ...props, onClose: () => setSettingsOpen(false) })}
      {toast && (
        <div style={{ position: "absolute", right: 24, bottom: 24, zIndex: 60 }}>
          <Toast tone="success" title={toast.title}>
            {toast.body}
          </Toast>
        </div>
      )}
    </div>
  );
}
