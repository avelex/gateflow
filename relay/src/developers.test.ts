import { test } from "node:test";
import assert from "node:assert/strict";
import { SESSION_COOKIE } from "./console.ts";
import { developerRoutes } from "./developers.ts";
import { dispatch } from "./main.ts";
import { secretFromSeed, signer } from "./near.ts";
import { fakeDeps, req, type TestDeps } from "./testing.ts";

/// A finished merchant with gateway `gateway` and a session cookie.
export function merchant(deps: TestDeps, email = "kaja@example.com", gateway = 0) {
  const account = `${email.split("@")[0]}.op.testnet`;
  deps.db.upsertMerchant({ email, name: "Kaja Coffee", account_id: account, public_key: "ed25519:passkey", gateway_id: gateway, step: "done", tokens_off: [] });
  const token = `t-${email}`;
  deps.db.createSession(token, email, deps.now());
  return { account, cookies: { [SESSION_COOKIE]: token } };
}

const call = (deps: TestDeps, method: string, path: string, body?: any, cookies?: Record<string, string>) =>
  dispatch(developerRoutes, req(method, path, body, cookies), deps);

test("api_keys_list_hides_secret", async () => {
  const deps = fakeDeps();
  const { cookies } = merchant(deps);
  const made = await call(deps, "POST", "/console/api-keys", { label: "shop" }, cookies);
  const key = (made.json as any).key as string;
  assert.match(key, /^gf_test_/);
  const list = (await call(deps, "GET", "/console/api-keys", undefined, cookies)).json as any[];
  assert.equal(list.length, 1);
  assert.deepEqual(Object.keys(list[0]).sort(), ["createdAt", "id", "label", "last4"]);
  assert.equal(list[0].last4, key.slice(-4));
  assert.ok(!JSON.stringify(list).includes(key));
  assert.equal((await call(deps, "POST", "/console/api-keys", { label: "" }, cookies)).status, 400);
});

test("api_keys_other_merchant", async () => {
  const deps = fakeDeps();
  const kaja = merchant(deps);
  const mo = merchant(deps, "mo@example.com", 1);
  await call(deps, "POST", "/console/api-keys", { label: "shop" }, kaja.cookies);
  const id = ((await call(deps, "GET", "/console/api-keys", undefined, kaja.cookies)).json as any[])[0].id;
  assert.equal((await call(deps, "DELETE", `/console/api-keys?id=${id}`, undefined, mo.cookies)).status, 404);
  assert.equal((await call(deps, "DELETE", "/console/api-keys?id=%25", undefined, kaja.cookies)).status, 404);
  assert.equal((await call(deps, "DELETE", `/console/api-keys?id=${id}`, undefined, kaja.cookies)).status, 200);
  assert.deepEqual((await call(deps, "GET", "/console/api-keys", undefined, kaja.cookies)).json, []);
});

test("dev_enabled_after_add_key", async () => {
  const secret = secretFromSeed(new Uint8Array(32).fill(9));
  const deps = fakeDeps({ invoiceSigner: secret });
  const { account, cookies } = merchant(deps);
  const pub = signer(secret).publicKeyString;
  const before = (await call(deps, "GET", "/console/dev", undefined, cookies)).json as any;
  assert.deepEqual(before, { available: true, enabled: false, signerPublicKey: pub, allowance: null, receiver: "gateflow.testnet", methods: ["create_invoice"] });
  deps.near.keys[`${account}/${pub}`] = 0n;
  assert.equal(((await call(deps, "GET", "/console/dev", undefined, cookies)).json as any).enabled, true);
  const none = fakeDeps();
  const m2 = merchant(none);
  assert.equal(((await call(none, "GET", "/console/dev", undefined, m2.cookies)).json as any).available, false);
});
