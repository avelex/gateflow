// The export's "Chat" screen: thread header, messages with trace line and cards, Thinking row, composer.
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api.ts";
import { Button, Icon } from "../ds.jsx";
import { ChatCard } from "./cards.tsx";
import type { ScreenProps } from "./Layout.tsx";
import { type ChatMsg, takePendingAsk, traceLabel } from "./logic.ts";
import { message } from "./Onboarding.tsx";

const FOOTER = "Gateflow can be wrong. Nothing changes until you confirm with your passkey.";
export const NOT_CONFIGURED = "Assistant not configured";

/// Swaps the URL without a history entry, so Back skips the empty /chat.
function replaceTo(path: string) {
  history.replaceState(null, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
}

function Avatar() {
  return <span style={{ width: 28, height: 28, flex: "none", borderRadius: "var(--radius-2)", background: "var(--ee-blue)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>g</span>;
}

export default function Chat({ thread, data, refresh, toast }: ScreenProps & { thread?: number }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [title, setTitle] = useState("New chat");
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string>();
  const [notConfigured, setNotConfigured] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  // The thread these messages belong to; it runs ahead of the prop while a new thread's URL is replaced.
  const threadRef = useRef<number>(undefined);

  const load = async (id: number) => {
    try {
      const t = await api<{ title: string; messages: ChatMsg[] }>("GET", `/console/thread?id=${id}`);
      if (threadRef.current !== id) return;
      setTitle(t.title);
      setMsgs(t.messages);
    } catch (e) {
      setError(message(e));
    }
  };

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || thinking) return;
    setError(undefined);
    setDraft("");
    setThinking(true);
    setMsgs((m) => [...m, { id: -1, role: "user", text: t, trace: [], cards: [], created_at: 0 }]);
    if (threadRef.current === undefined) setTitle(t.slice(0, 60));
    try {
      const r = await api<{ threadId: number; messages: ChatMsg[] }>("POST", "/console/chat", { threadId: threadRef.current, message: t });
      setMsgs((m) => [...m.filter((x) => x.id !== -1), ...r.messages]);
      if (threadRef.current !== r.threadId) {
        threadRef.current = r.threadId;
        replaceTo(`/console/chat/${r.threadId}`);
      }
      refresh();
    } catch (e) {
      setMsgs((m) => m.filter((x) => x.id !== -1));
      setDraft(t);
      if (e instanceof ApiError && e.status === 503) setNotConfigured(true);
      else setError(message(e));
    } finally {
      setThinking(false);
    }
  };

  useEffect(() => {
    if (thread !== undefined && thread === threadRef.current) return; // our own replaceTo after the first reply
    threadRef.current = thread;
    setError(undefined);
    setMsgs([]);
    if (thread !== undefined) return void load(thread);
    setTitle("New chat");
    const first = takePendingAsk();
    if (first) void send(first);
  }, [thread]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [msgs.length, thinking]);

  const onChanged = () => {
    refresh();
    if (threadRef.current !== undefined) void load(threadRef.current);
  };

  return (
    <div data-screen-label="Chat" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <header style={{ height: 56, flex: "none", display: "flex", alignItems: "center", padding: "0 16px 0 24px", borderBottom: "1px solid var(--border-1)", background: "var(--surface-card)" }}>
        <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
      </header>
      <div ref={scroller} style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 32px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 0 24px", display: "flex", flexDirection: "column", gap: 28 }}>
          {msgs.map((m) =>
            m.role === "user" ? (
              <div key={m.id} style={{ display: "flex", justifyContent: "flex-end" }}>
                <div style={{ maxWidth: "80%", background: "var(--ink-150)", borderRadius: "var(--radius-3)", padding: "10px 14px", fontSize: 15, lineHeight: "22px", whiteSpace: "pre-wrap" }}>{m.text}</div>
              </div>
            ) : (
              <div key={m.id} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <Avatar />
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 14, paddingTop: 3 }}>
                  {m.trace.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-3)" }}>
                      <Icon name="list-checks" size={14} />
                      <span style={{ fontFamily: "var(--font-mono)" }}>{traceLabel(m.trace)}</span>
                    </div>
                  )}
                  <div style={{ fontSize: 15, lineHeight: "24px", textWrap: "pretty", whiteSpace: "pre-wrap" }}>{m.text}</div>
                  {m.cards.map((c, i) => (
                    <ChatCard key={i} card={c} data={data} onAsk={send} onChanged={onChanged} toast={toast} />
                  ))}
                </div>
              </div>
            ),
          )}
          {thinking && (
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <Avatar />
              <span role="status" style={{ fontSize: 13, color: "var(--blue-600)" }}>
                Thinking
                <span className="gf-think" aria-hidden="true">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </span>
            </div>
          )}
          {error && <div style={{ fontSize: 13, color: "var(--red-700)" }}>{error}</div>}
        </div>
      </div>
      <div style={{ flex: "none", padding: "0 32px 16px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ background: "var(--surface-card)", border: "1px solid var(--border-2)", borderRadius: "var(--radius-3)", boxShadow: "var(--shadow-2)", padding: "12px 12px 10px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
            <textarea
              rows={1}
              aria-label="Message"
              placeholder={notConfigured ? NOT_CONFIGURED : "Reply to Gateflow"}
              disabled={notConfigured}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), void send(draft))}
              style={{ border: 0, outline: 0, resize: "none", fontFamily: "var(--font-sans)", fontSize: 15, lineHeight: "24px", background: "transparent", color: "var(--text-1)", padding: 0, width: "100%" }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1 }} />
              <Button variant="primary" size="sm" icon="arrow-up" disabled={notConfigured || thinking || !draft.trim()} onClick={() => void send(draft)} />
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)", textAlign: "center" }}>{FOOTER}</div>
        </div>
      </div>
    </div>
  );
}
