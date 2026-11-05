import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "./db.ts";

test("quotes_columns_added", () => {
  const path = join(mkdtempSync(join(tmpdir(), "gateflow-db-")), "old.db");
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE quotes (ref TEXT PRIMARY KEY, invoice INTEGER NOT NULL, deposit_address TEXT NOT NULL UNIQUE,
    deadline_ms INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING_DEPOSIT', screened INTEGER NOT NULL DEFAULT 0)`);
  old.prepare("INSERT INTO quotes (ref, invoice, deposit_address, deadline_ms) VALUES ('r', 1, 'd', 5)").run();
  old.close();
  const db = openDb(path);
  const q = db.quoteByRef("r")!;
  assert.equal(q.deposit_seen_ms, null);
  assert.equal(q.origin_chain, null);
  assert.equal(q.origin_senders, null);
  openDb(path); // a second open adds nothing and does not throw
});
