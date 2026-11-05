import { test } from "node:test";
import assert from "node:assert/strict";
import { developerRoutes } from "./developers.ts";
import { dispatch } from "./main.ts";
import { secretFromSeed, signer } from "./near.ts";
import { fakeDeps, merchant, req, type TestDeps } from "./testing.ts";

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
  assert.deepEqual(before, { available: true, enabled: false, signerPublicKey: pub, allowance: null, receiver: "gateflow.testnet", methods: ["create_invoice"], webhookUrl: null, origins: [] });
  deps.near.keys[`${account}/${pub}`] = 0n;
  assert.equal(((await call(deps, "GET", "/console/dev", undefined, cookies)).json as any).enabled, true);
  const none = fakeDeps();
  const m2 = merchant(none);
  assert.equal(((await call(none, "GET", "/console/dev", undefined, m2.cookies)).json as any).available, false);
});

test("webhook_requires_https", async () => {
  const deps = fakeDeps();
  const { cookies } = merchant(deps);
  for (const url of ["http://shop.example/hook", "ftp://x", "not a url", 5])
    assert.equal((await call(deps, "PUT", "/console/webhook", { url }, cookies)).status, 400, String(url));
  assert.equal((await call(deps, "POST", "/console/webhook/secret", undefined, cookies)).status, 409);
});

test("webhook_secret_once", async () => {
  const deps = fakeDeps();
  const { cookies } = merchant(deps);
  const set = (await call(deps, "PUT", "/console/webhook", { url: "https://shop.example/hook" }, cookies)).json as any;
  assert.match(set.secret, /^whsec_/);
  const dev = JSON.stringify((await call(deps, "GET", "/console/dev", undefined, cookies)).json);
  assert.ok(dev.includes("https://shop.example/hook") && !dev.includes(set.secret));
  const rolled = (await call(deps, "POST", "/console/webhook/secret", undefined, cookies)).json as any;
  assert.notEqual(rolled.secret, set.secret);
  assert.equal(deps.db.gatewayDev(0).webhook_secret, rolled.secret);
  await call(deps, "PUT", "/console/webhook", { url: null }, cookies);
  assert.deepEqual(deps.db.gatewayDev(0), { webhook_url: null, webhook_secret: null, origins: [] });
});

test("origins_validated", async () => {
  const deps = fakeDeps();
  const { cookies } = merchant(deps);
  const good = await call(deps, "PUT", "/console/origins", { origins: ["https://shop.example", "https://shop.example:8443", "http://localhost:8080", "https://shop.example"] }, cookies);
  assert.deepEqual(good.json, { origins: ["https://shop.example", "https://shop.example:8443", "http://localhost:8080"] });
  for (const bad of ["https://shop.example/", "https://shop.example/path", "http://shop.example", "shop.example", "https://*.shop.example"])
    assert.equal((await call(deps, "PUT", "/console/origins", { origins: [bad] }, cookies)).status, 400, bad);
  const main = fakeDeps({ gateflow: "gateflow.near" });
  const m = merchant(main);
  assert.equal((await call(main, "PUT", "/console/origins", { origins: ["http://localhost:8080"] }, m.cookies)).status, 400);
});
