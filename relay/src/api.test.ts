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
