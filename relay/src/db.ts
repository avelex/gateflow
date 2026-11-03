// SQLite state: merchants, sessions and issued 1Click quotes. Amounts stay on-chain.
import { DatabaseSync } from "node:sqlite";

export type Step = "account" | "tokens" | "gateway" | "done";

export type Merchant = {
  email: string;
  name: string;
  account_id: string | null;
  public_key: string | null;
  gateway_id: number | null;
  step: Step;
  tokens_off: string[];
};

export type Quote = {
  ref: string;
  invoice: number;
  deposit_address: string;
  deadline_ms: number;
  status: string;
  screened: number;
};

export type Card = { type: "invoice"; invoiceId: number } | { type: "status"; invoiceId: number } | { type: "confirm"; actionId: number };
export type Thread = { id: number; email: string; title: string; created_at: number };
export type Message = {
  id?: number;
  thread_id: number;
  role: "user" | "assistant";
  text: string;
  trace: string[];
  cards: Card[];
  created_at: number;
};
export type ActionKind = "create_invoice" | "set_policy" | "retry";
export type ActionStatus = "pending" | "done" | "dismissed" | "failed";
export type ChatAction = { id: number; thread_id: number; email: string; kind: ActionKind; params: any; summary: string; status: ActionStatus; result: any };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS merchants (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  account_id TEXT UNIQUE,
  public_key TEXT,
  gateway_id INTEGER,
  step TEXT NOT NULL DEFAULT 'account',
  tokens_off TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, email TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS quotes (
  ref TEXT PRIMARY KEY,
  invoice INTEGER NOT NULL,
  deposit_address TEXT NOT NULL UNIQUE,
  deadline_ms INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_DEPOSIT',
  screened INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chat_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  trace TEXT NOT NULL DEFAULT '[]',
  cards TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_messages_thread ON chat_messages (thread_id, id);
CREATE TABLE IF NOT EXISTS chat_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  kind TEXT NOT NULL,
  params TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT
);`;

const toMessage = (row: any): Message => ({ ...row, trace: JSON.parse(row.trace), cards: JSON.parse(row.cards) });
const toAction = (row: any): ChatAction | undefined => row && { ...row, params: JSON.parse(row.params), result: row.result === null ? null : JSON.parse(row.result) };

const toMerchant = (row: any): Merchant | undefined =>
  row && { ...row, gateway_id: row.gateway_id ?? null, tokens_off: JSON.parse(row.tokens_off) };

export function openDb(path: string) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const q = (sql: string) => db.prepare(sql);
  const byEmail = q("SELECT * FROM merchants WHERE email = ?");
  const byAccount = q("SELECT * FROM merchants WHERE account_id = ?");
  const byGateway = q("SELECT * FROM merchants WHERE gateway_id = ?");
  const count = q("SELECT COUNT(*) AS n FROM merchants");
  const withGateway = q("SELECT * FROM merchants WHERE gateway_id IS NOT NULL ORDER BY gateway_id");
  const upsert = q(`INSERT INTO merchants (email, name, account_id, public_key, gateway_id, step, tokens_off)
    VALUES (:email, :name, :account_id, :public_key, :gateway_id, :step, :tokens_off)
    ON CONFLICT(email) DO UPDATE SET name = :name, account_id = :account_id, public_key = :public_key,
      gateway_id = :gateway_id, step = :step, tokens_off = :tokens_off`);
  const newSession = q("INSERT INTO sessions (token, email, created_at) VALUES (?, ?, ?)");
  const session = q("SELECT email FROM sessions WHERE token = ?");
  const dropSession = q("DELETE FROM sessions WHERE token = ?");
  const newQuote = q("INSERT INTO quotes (ref, invoice, deposit_address, deadline_ms) VALUES (?, ?, ?, ?)");
  const quoteByDeposit = q("SELECT * FROM quotes WHERE deposit_address = ?");
  const quoteByRef = q("SELECT * FROM quotes WHERE ref = ?");
  const open = q("SELECT * FROM quotes WHERE screened = 0 AND status NOT IN ('REFUNDED', 'FAILED') AND deadline_ms + 3600000 >= ?");
  const setStatus = q("UPDATE quotes SET status = ? WHERE ref = ?");
  const setScreened = q("UPDATE quotes SET screened = 1 WHERE ref = ?");
  const newThread = q("INSERT INTO chat_threads (email, title, created_at) VALUES (?, ?, ?)");
  const threadById = q("SELECT * FROM chat_threads WHERE id = ? AND email = ?");
  const threadsOf = q("SELECT * FROM chat_threads WHERE email = ? ORDER BY id DESC LIMIT ?");
  const newMessage = q("INSERT INTO chat_messages (thread_id, role, text, trace, cards, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  const lastMessages = q("SELECT * FROM (SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id");
  const userSince = q(`SELECT COUNT(*) AS n FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id
    WHERE t.email = ? AND m.role = 'user' AND m.created_at >= ?`);
  const newAction = q("INSERT INTO chat_actions (thread_id, email, kind, params, summary) VALUES (?, ?, ?, ?, ?)");
  const dismiss = q("UPDATE chat_actions SET status = 'dismissed' WHERE id = ? AND status = 'pending'");
  const actionById = q("SELECT * FROM chat_actions WHERE id = ? AND email = ?");
  const claim = q("UPDATE chat_actions SET status = 'done' WHERE id = ? AND status = 'pending'");
  const finish = q("UPDATE chat_actions SET status = ?, result = ? WHERE id = ?");

  return {
    merchantByEmail: (email: string) => toMerchant(byEmail.get(email)),
    merchantByAccount: (id: string) => toMerchant(byAccount.get(id)),
    merchantByGateway: (id: number) => toMerchant(byGateway.get(id)),
    merchantCount: () => Number((count.get() as any).n),
    merchantsWithGateway: () => withGateway.all().map((r) => toMerchant(r)!),
    upsertMerchant(m: Merchant) {
      upsert.run({ ...m, tokens_off: JSON.stringify(m.tokens_off) });
    },
    createSession: (token: string, email: string, now: number) => void newSession.run(token, email, now),
    sessionEmail: (token: string) => (session.get(token) as any)?.email as string | undefined,
    deleteSession: (token: string) => void dropSession.run(token),
    insertQuote: (x: { ref: string; invoice: number; deposit_address: string; deadline_ms: number }) =>
      void newQuote.run(x.ref, x.invoice, x.deposit_address, x.deadline_ms),
    quoteByDeposit: (addr: string) => quoteByDeposit.get(addr) as Quote | undefined,
    quoteByRef: (ref: string) => quoteByRef.get(ref) as Quote | undefined,
    openQuotes: (nowMs: number) => open.all(nowMs) as Quote[],
    markQuote(ref: string, change: { status?: string; screened?: boolean }) {
      if (change.status) setStatus.run(change.status, ref);
      if (change.screened) setScreened.run(ref);
    },
    createThread: (email: string, title: string, now: number) => Number(newThread.run(email, title, now).lastInsertRowid),
    thread(id: number, email: string): Thread | undefined {
      const row = threadById.get(id, email);
      return row && ({ ...row } as Thread);
    },
    threadsOf: (email: string, limit: number) => threadsOf.all(email, limit).map((r) => ({ ...r }) as Thread),
    addMessage: (m: Message) =>
      Number(newMessage.run(m.thread_id, m.role, m.text, JSON.stringify(m.trace), JSON.stringify(m.cards), m.created_at).lastInsertRowid),
    /// The thread's last `limit` messages, oldest first.
    messages: (threadId: number, limit: number) => lastMessages.all(threadId, limit).map(toMessage),
    userMessagesSince: (email: string, sinceSec: number) => Number((userSince.get(email, sinceSec) as any).n),
    addAction: (a: { thread_id: number; email: string; kind: ActionKind; params: unknown; summary: string }) =>
      Number(newAction.run(a.thread_id, a.email, a.kind, JSON.stringify(a.params), a.summary).lastInsertRowid),
    action: (id: number, email: string) => toAction(actionById.get(id, email)),
    /// Marks a pending action done; false when it was not pending (already claimed, dismissed or failed).
    claimAction: (id: number) => Number(claim.run(id).changes) === 1,
    /// Marks a pending action dismissed; false when it was not pending.
    dismissAction: (id: number) => Number(dismiss.run(id).changes) === 1,
    finishAction: (id: number, status: ActionStatus, result: unknown) => void finish.run(status, JSON.stringify(result ?? null), id),
  };
}

export type Db = ReturnType<typeof openDb>;
