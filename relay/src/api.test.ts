import { test } from "node:test";
import assert from "node:assert/strict";
import { keyHash, newApiKey, newWebhookSecret } from "./api.ts";
import { openDb } from "./db.ts";

test("api_key_format", () => {
  assert.match(newApiKey(true), /^gf_test_[0-9A-Za-z]{43}$/);
  assert.match(newApiKey(false), /^gf_live_[0-9A-Za-z]{43}$/);
  assert.notEqual(newApiKey(true), newApiKey(true));
  assert.match(newWebhookSecret(), /^whsec_[0-9A-Za-z]{43}$/);
});

test("key_hash_stable", () => {
  assert.equal(keyHash("gf_test_x"), keyHash("gf_test_x"));
  assert.match(keyHash("gf_test_x"), /^[0-9a-f]{64}$/);
  assert.notEqual(keyHash("gf_test_x"), keyHash("gf_test_y"));
});

test("revoked_key_not_found", () => {
  const db = openDb(":memory:");
  db.upsertMerchant({ email: "kaja@example.com", name: "Kaja", account_id: "kaja.op", public_key: "ed25519:x", gateway_id: 3, step: "done", tokens_off: [] });
  const h = keyHash("gf_test_k");
  db.addApiKey({ hash: h, email: "kaja@example.com", label: "shop", last4: "es_k", created_at: 1 });
  assert.equal(db.merchantByKeyHash(h)?.gateway_id, 3);
  assert.equal(db.apiKeys("kaja@example.com").length, 1);
  assert.equal(db.revokeApiKey("other@example.com", h.slice(0, 12), 2), false);
  assert.equal(db.revokeApiKey("kaja@example.com", h.slice(0, 12), 2), true);
  assert.equal(db.merchantByKeyHash(h), undefined);
  assert.deepEqual(db.apiKeys("kaja@example.com"), []);
});

import { apiStatus, fromRaw, invoiceObject, toRaw } from "./api.ts";

test("to_raw_usdc", () => {
  assert.equal(toRaw("10.00", 6), 10_000_000n);
  assert.equal(toRaw("10", 6), 10_000_000n);
  assert.equal(toRaw("0.0001", 8), 10_000n);
});

test("to_raw_rejects", () => {
  for (const bad of ["0", "0.000", "1.1234567", "abc", "-1", "1e3", "", " 1", "1."]) assert.throws(() => toRaw(bad, 6), bad);
});

test("from_raw_formats", () => {
  assert.equal(fromRaw(10_000_000n, 6), "10.00");
  assert.equal(fromRaw(1_234_567n, 6), "1.234567");
  assert.equal(fromRaw(10_000n, 8), "0.0001");
});

test("api_status_expired", () => {
  const inv = { status: "Open", expires_at_sec: 100 };
  assert.equal(apiStatus(inv, 99_999), "open");
  assert.equal(apiStatus(inv, 100_000), "expired");
  assert.equal(apiStatus({ status: "Paying", expires_at_sec: 100 }, 200_000), "paying");
  assert.equal(apiStatus({ status: "Returned", expires_at_sec: 100 }, 0), "returned");
});

test("invoice_object_shape", () => {
  const inv = { gateway: 0, token: "usdc.testnet", amount: "10000000", expires_at_sec: 1_800, memo: "order_123", status: "Open", payment: null };
  assert.deepEqual(invoiceObject(42, inv, { symbol: "USDC", decimals: 6 }, "https://gw.example/", 0), {
    id: 42, url: "https://gw.example/pay/42", status: "open", amount: "10.00", currency: "USDC", order_id: "order_123", expires_at: "1970-01-01T00:30:00.000Z",
  });
});
