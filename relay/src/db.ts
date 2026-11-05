// SQLite state: merchants, sessions, issued 1Click quotes and screening txs. Amounts stay on-chain.
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
  /// When the watcher first saw the deposit (ms); null until then.
  deposit_seen_ms: number | null;
  /// The origin chain of the quoted asset, and the JSON array of addresses that sent the deposit.
  origin_chain: string | null;
  origin_senders: string | null;
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

const NOT_ARRIVED = new Set(["PENDING_DEPOSIT", "UNKNOWN"]);

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
CREATE TABLE IF NOT EXISTS screenings (
  payment INTEGER PRIMARY KEY,
  tx_hash TEXT NOT NULL,
  sender TEXT NOT NULL,
  evidence TEXT
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
);
CREATE TABLE IF NOT EXISTS api_keys (
  hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  label TEXT NOT NULL,
  last4 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS api_invoices (
  invoice INTEGER PRIMARY KEY,
  gateway INTEGER NOT NULL,
  order_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS api_invoices_order ON api_invoices (gateway, order_id);
CREATE TABLE IF NOT EXISTS gateway_dev (
  gateway INTEGER PRIMARY KEY,
  webhook_url TEXT,
  webhook_secret TEXT,
  origins TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice INTEGER NOT NULL,
  event TEXT NOT NULL,
  body TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at_ms INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0
);`;

const toMessage = (row: any): Message => ({ ...row, trace: JSON.parse(row.trace), cards: JSON.parse(row.cards) });
const toAction = (row: any): ChatAction | undefined => row && { ...row, params: JSON.parse(row.params), result: row.result === null ? null : JSON.parse(row.result) };

const toMerchant = (row: any): Merchant | undefined =>
  row && { ...row, gateway_id: row.gateway_id ?? null, tokens_off: JSON.parse(row.tokens_off) };

export function openDb(path: string) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  // Columns added after the first deployment; old databases gain them here.
  const have = new Set((db.prepare("PRAGMA table_info(quotes)").all() as any[]).map((c) => c.name));
  for (const [name, type] of [["deposit_seen_ms", "INTEGER"], ["origin_chain", "TEXT"], ["origin_senders", "TEXT"]])
    if (!have.has(name)) db.exec(`ALTER TABLE quotes ADD COLUMN ${name} ${type}`);
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
  const newQuote = q("INSERT INTO quotes (ref, invoice, deposit_address, deadline_ms, origin_chain) VALUES (?, ?, ?, ?, ?)");
  const quoteByDeposit = q("SELECT * FROM quotes WHERE deposit_address = ?");
  const quoteByRef = q("SELECT * FROM quotes WHERE ref = ?");
  // Screened quotes stay open until their origin senders are known.
  const open = q(`SELECT * FROM quotes WHERE (screened = 0 OR (origin_senders IS NULL AND origin_chain IS NOT NULL))
    AND status NOT IN ('REFUNDED', 'FAILED') AND deadline_ms + 3600000 >= ?`);
  const setSenders = q("UPDATE quotes SET origin_senders = ? WHERE ref = ?");
  const setStatus = q("UPDATE quotes SET status = ? WHERE ref = ?");
  const setScreened = q("UPDATE quotes SET screened = 1 WHERE ref = ?");
  const setDepositSeen = q("UPDATE quotes SET deposit_seen_ms = ? WHERE ref = ? AND deposit_seen_ms IS NULL");
  const newScreening = q("INSERT OR IGNORE INTO screenings (payment, tx_hash, sender) VALUES (?, ?, ?)");
  const screeningOf = q("SELECT tx_hash, sender, evidence FROM screenings WHERE payment = ?");
  const setEvidence = q("UPDATE screenings SET evidence = ? WHERE payment = ?");
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
  const newKey = q("INSERT INTO api_keys (hash, email, label, last4, created_at) VALUES (?, ?, ?, ?, ?)");
  const keysOf = q("SELECT hash, label, last4, created_at FROM api_keys WHERE email = ? AND revoked_at IS NULL ORDER BY created_at");
  const revokeKey = q("UPDATE api_keys SET revoked_at = ? WHERE email = ? AND hash LIKE ? || '%' AND revoked_at IS NULL");
  const newApiInvoice = q("INSERT INTO api_invoices (invoice, gateway, order_id, expires_at_ms) VALUES (?, ?, ?, ?)");
  const apiByOrder = q("SELECT * FROM api_invoices WHERE gateway = ? AND order_id = ? ORDER BY invoice DESC");
  const apiById = q("SELECT * FROM api_invoices WHERE invoice = ?");
  const devOf = q("SELECT * FROM gateway_dev WHERE gateway = ?");
  const devInit = q("INSERT OR IGNORE INTO gateway_dev (gateway) VALUES (?)");
  const setWebhook = q("UPDATE gateway_dev SET webhook_url = ?, webhook_secret = ? WHERE gateway = ?");
  const setOrigins = q("UPDATE gateway_dev SET origins = ? WHERE gateway = ?");
  const keyOwner = q("SELECT email FROM api_keys WHERE hash = ? AND revoked_at IS NULL");

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
    insertQuote: (x: { ref: string; invoice: number; deposit_address: string; deadline_ms: number; origin_chain?: string }) =>
      void newQuote.run(x.ref, x.invoice, x.deposit_address, x.deadline_ms, x.origin_chain ?? null),
    quoteByDeposit: (addr: string) => quoteByDeposit.get(addr) as Quote | undefined,
    quoteByRef: (ref: string) => quoteByRef.get(ref) as Quote | undefined,
    openQuotes: (nowMs: number) => open.all(nowMs) as Quote[],
    /// A status other than PENDING_DEPOSIT or UNKNOWN, with `nowMs`, records the first time the deposit was seen.
    markQuote(ref: string, change: { status?: string; screened?: boolean; nowMs?: number }) {
      if (change.status) setStatus.run(change.status, ref);
      if (change.status && change.nowMs !== undefined && !NOT_ARRIVED.has(change.status)) setDepositSeen.run(change.nowMs, ref);
      if (change.screened) setScreened.run(ref);
    },
    /// The deposit's origin senders; an empty list means the tx names none (a shielded deposit).
    setOriginSenders: (ref: string, senders: string[]) => void setSenders.run(JSON.stringify(senders), ref),
    /// The first recorded screening tx of a payment wins.
    recordScreening: (payment: number, txHash: string, sender: string) => void newScreening.run(payment, txHash, sender),
    screening(payment: number) {
      const row = screeningOf.get(payment);
      return row && ({ ...row } as { tx_hash: string; sender: string; evidence: string | null });
    },
    storeEvidence: (payment: number, evidence: unknown) => void setEvidence.run(JSON.stringify(evidence), payment),
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
    addApiKey: (k: { hash: string; email: string; label: string; last4: string; created_at: number }) =>
      void newKey.run(k.hash, k.email, k.label, k.last4, k.created_at),
    /// Live (unrevoked) keys of a merchant, oldest first.
    apiKeys: (email: string) => keysOf.all(email).map((r) => ({ ...r }) as { hash: string; label: string; last4: string; created_at: number }),
    /// Revokes the merchant's live key whose hash starts with `hashPrefix`; false when none matched.
    revokeApiKey: (email: string, hashPrefix: string, now: number) => Number(revokeKey.run(now, email, hashPrefix).changes) > 0,
    insertApiInvoice: (x: { invoice: number; gateway: number; order_id: string | null; expires_at_ms: number }) =>
      void newApiInvoice.run(x.invoice, x.gateway, x.order_id, x.expires_at_ms),
    /// API invoices of a gateway for one order id, newest first.
    apiInvoicesByOrder: (gateway: number, orderId: string) => apiByOrder.all(gateway, orderId).map((r) => ({ ...r }) as ApiInvoice),
    apiInvoice: (id: number) => {
      const r = apiById.get(id);
      return r && ({ ...r } as ApiInvoice);
    },
    /// Webhook and allowed origins of a gateway; empty when never set.
    gatewayDev(gateway: number): GatewayDev {
      const r = devOf.get(gateway) as any;
      return { webhook_url: r?.webhook_url ?? null, webhook_secret: r?.webhook_secret ?? null, origins: JSON.parse(r?.origins ?? "[]") };
    },
    setWebhook(gateway: number, url: string | null, secret: string | null) {
      devInit.run(gateway);
      setWebhook.run(url, secret, gateway);
    },
    setOrigins(gateway: number, origins: string[]) {
      devInit.run(gateway);
      setOrigins.run(JSON.stringify(origins), gateway);
    },
    merchantByKeyHash(hash: string) {
      const row = keyOwner.get(hash) as { email: string } | undefined;
      return row && toMerchant(byEmail.get(row.email));
    },
  };
}

export type Db = ReturnType<typeof openDb>;
export type GatewayDev = { webhook_url: string | null; webhook_secret: string | null; origins: string[] };
export type ApiInvoice = { invoice: number; gateway: number; order_id: string | null; status: string; expires_at_ms: number };
