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
);`;

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

  return {
    merchantByEmail: (email: string) => toMerchant(byEmail.get(email)),
    merchantByAccount: (id: string) => toMerchant(byAccount.get(id)),
    merchantByGateway: (id: number) => toMerchant(byGateway.get(id)),
    merchantCount: () => Number((count.get() as any).n),
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
  };
}

export type Db = ReturnType<typeof openDb>;
