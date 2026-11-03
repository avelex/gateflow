import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db.ts";
import { dispatch } from "./main.ts";
import { serveStatic } from "./static.ts";
import { fakeDeps, req } from "./testing.ts";
import { HttpError } from "./types.ts";

test("db_merchant_roundtrip", () => {
  const db = openDb(":memory:");
  const m = { email: "kaja@example.com", name: "Kaja", account_id: "kaja.op", public_key: "ed25519:x", gateway_id: 3, step: "done" as const, tokens_off: ["zec.omft.near"], payout_to: "kaja-shop.near" };
  db.upsertMerchant(m);
  assert.deepEqual(db.merchantByEmail("kaja@example.com"), m);
  assert.deepEqual(db.merchantByAccount("kaja.op"), m);
  assert.deepEqual(db.merchantByGateway(3), m);
  assert.equal(db.merchantCount(), 1);
  db.upsertMerchant({ ...m, step: "gateway", gateway_id: null });
  assert.equal(db.merchantByEmail("kaja@example.com")?.gateway_id, null);
  assert.equal(db.merchantCount(), 1);
});

test("db_adds_payout_column_to_old_db", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const path = join(mkdtempSync(join(tmpdir(), "gateflow-")), "old.db");
  const old = new DatabaseSync(path);
  old.exec("CREATE TABLE merchants (email TEXT PRIMARY KEY, name TEXT NOT NULL, account_id TEXT UNIQUE, public_key TEXT, gateway_id INTEGER, step TEXT NOT NULL DEFAULT 'account', tokens_off TEXT NOT NULL DEFAULT '[]')");
  old.exec("INSERT INTO merchants (email, name, account_id, step) VALUES ('a@b.c', 'A', 'a.op', 'done')");
  old.close();
  const db = openDb(path);
  assert.equal(db.merchantByEmail("a@b.c")?.payout_to, null);
  db.upsertMerchant({ ...db.merchantByEmail("a@b.c")!, payout_to: "a-shop.near" });
  assert.equal(db.merchantByEmail("a@b.c")?.payout_to, "a-shop.near");
});

test("db_quote_lifecycle", () => {
  const db = openDb(":memory:");
  db.insertQuote({ ref: "a", invoice: 1, deposit_address: "d1", deadline_ms: 1000 });
  db.insertQuote({ ref: "b", invoice: 2, deposit_address: "d2", deadline_ms: 1000 });
  db.insertQuote({ ref: "c", invoice: 3, deposit_address: "d3", deadline_ms: 1000 });
  db.markQuote("b", { screened: true });
  db.markQuote("c", { status: "REFUNDED" });
  assert.deepEqual(db.openQuotes(1000 + 3600000).map((q) => q.ref), ["a"]);
  assert.deepEqual(db.openQuotes(1000 + 3600001), []);
  assert.equal(db.quoteByDeposit("d2")?.screened, 1);
  assert.equal(db.quoteByRef("c")?.status, "REFUNDED");
});

function webDir() {
  const dir = mkdtempSync(join(tmpdir(), "web-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<html>app</html>");
  writeFileSync(join(dir, "assets", "a.js"), "x=1");
  return dir;
}

test("static_spa_fallback", () => {
  const dir = webDir();
  assert.equal(String(serveStatic(dir, "/pay/7")?.body), "<html>app</html>");
  assert.equal(serveStatic(dir, "/assets/a.js")?.headers?.["content-type"], "text/javascript; charset=utf-8");
  assert.equal(String(serveStatic(dir, "/../../etc/passwd")?.body), "<html>app</html>");
  assert.equal(serveStatic(dir, "/console/nope"), undefined);
});

test("static_api_404_json", async () => {
  const deps = fakeDeps({ webDist: webDir() });
  assert.deepEqual(await dispatch({}, req("GET", "/console/nope"), deps), { status: 404, json: { error: "not found" } });
  const noWeb = fakeDeps();
  assert.equal((await dispatch({}, req("GET", "/"), noWeb)).status, 404);
});

test("dispatch_maps_http_error", async () => {
  const deps = fakeDeps();
  const table = {
    "GET /console/a": async () => {
      throw new HttpError(409, "conflict");
    },
    "GET /console/b": async () => {
      throw new Error("rpc down");
    },
  };
  assert.deepEqual(await dispatch(table, req("GET", "/console/a"), deps), { status: 409, json: { error: "conflict" } });
  const b = await dispatch(table, req("GET", "/console/b"), deps);
  assert.equal(b.status, 502);
});

test("checkout_cors_and_options", async () => {
  const deps = fakeDeps();
  const opt = await dispatch({}, req("OPTIONS", "/checkout/quote"), deps);
  assert.equal(opt.status, 204);
  assert.equal(opt.headers?.["access-control-allow-origin"], "*");
  const miss = await dispatch({}, req("GET", "/checkout/nope"), deps);
  assert.equal(miss.status, 404);
  assert.equal(miss.headers?.["access-control-allow-origin"], "*");
  const consoleMiss = await dispatch({}, req("GET", "/console/nope"), deps);
  assert.equal(consoleMiss.headers?.["access-control-allow-origin"], undefined);
});
