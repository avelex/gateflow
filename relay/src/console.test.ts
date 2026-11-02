import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "./main.ts";
import { consoleRoutes, SESSION_COOKIE } from "./console.ts";
import { fakeDeps, req, type TestDeps } from "./testing.ts";

const call = (deps: TestDeps, method: string, path: string, body?: any, cookies?: Record<string, string>) =>
  dispatch(consoleRoutes, req(method, path, body, cookies), deps);

export async function signedIn(deps: TestDeps, email = "kaja@example.com") {
  const res = await call(deps, "POST", "/console/session", { email });
  const token = /gateflow_session=([0-9a-f]+)/.exec(res.headers?.["set-cookie"] ?? "")![1];
  return { [SESSION_COOKIE]: token };
}

test("session_sets_cookie_flags", async () => {
  const deps = fakeDeps();
  const res = await call(deps, "POST", "/console/session", { email: " Kaja@Example.com " });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { step: "account" });
  assert.match(res.headers!["set-cookie"], /^gateflow_session=[0-9a-f]{64}; HttpOnly; SameSite=Lax; Path=\/$/);
  const me = await call(deps, "GET", "/console/me", undefined, await signedIn(deps, "KAJA@example.com"));
  assert.equal((me.json as any).email, "kaja@example.com");
});

test("session_secure_on_https", async () => {
  const deps = fakeDeps({ publicUrl: "https://gateflow.example" });
  const res = await call(deps, "POST", "/console/session", { email: "kaja@example.com" });
  assert.match(res.headers!["set-cookie"], /; Secure$/);
});

test("session_rejects_bad_email", async () => {
  const res = await call(fakeDeps(), "POST", "/console/session", { email: "kaja@" });
  assert.equal(res.status, 400);
  assert.equal(res.headers?.["set-cookie"], undefined);
});

test("me_requires_session", async () => {
  const deps = fakeDeps();
  assert.equal((await call(deps, "GET", "/console/me")).status, 401);
  assert.equal((await call(deps, "GET", "/console/me", undefined, { [SESSION_COOKIE]: "deadbeef" })).status, 401);
});

test("logout_deletes_session", async () => {
  const deps = fakeDeps();
  const cookies = await signedIn(deps);
  assert.equal((await call(deps, "GET", "/console/me", undefined, cookies)).status, 200);
  const out = await call(deps, "DELETE", "/console/session", undefined, cookies);
  assert.match(out.headers!["set-cookie"], /Max-Age=0/);
  assert.equal((await call(deps, "GET", "/console/me", undefined, cookies)).status, 401);
});

// ---------- provisioning ----------

import { generateKeyPairSync } from "node:crypto";
import { secretFromSeed, signer } from "./near.ts";
import { slug } from "./console.ts";

export function newKey() {
  const seed = new Uint8Array(generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).subarray(16));
  const secret = secretFromSeed(seed);
  return { secret, publicKey: signer(secret).publicKeyString };
}

export function withTokens(deps: TestDeps, tokens = ["wrap.testnet", "usdc.testnet"]) {
  deps.near.viewTable["gateflow.testnet.get_tokens"] = tokens;
  for (const t of tokens) deps.near.viewTable[`${t}.storage_balance_bounds`] = { min: "1250000000000000000000", max: "1250000000000000000000" };
}

export async function onboarded(deps: TestDeps, name = "Kaja Coffee") {
  withTokens(deps);
  const cookies = await signedIn(deps);
  const key = newKey();
  const res = await call(deps, "POST", "/console/onboard", { name, publicKey: key.publicKey }, cookies);
  return { cookies, key, res };
}

test("slug_basic", () => assert.equal(slug("Kaja Coffee"), "kaja-coffee"));
test("slug_non_latin_falls_back", () => assert.equal(slug("Кафе"), "merchant"));
test("slug_trimmed_32", () => {
  const s = slug("A very long business name that keeps going and going");
  assert.ok(s.length <= 32);
  assert.ok(!s.endsWith("-"));
});

test("slug_suffix_when_taken", async () => {
  const deps = fakeDeps();
  deps.near.existing.add("kaja-coffee.op.testnet");
  const { res } = await onboarded(deps);
  assert.equal((res.json as any).accountId, "kaja-coffee-2.op.testnet");
});

test("onboard_account_tx_actions", async () => {
  const deps = fakeDeps();
  const { res, key } = await onboarded(deps);
  assert.deepEqual(res.json, { step: "gateway", accountId: "kaja-coffee.op.testnet" });
  const first = deps.near.sent[0];
  assert.equal(first.receiver, "kaja-coffee.op.testnet");
  assert.deepEqual(first.actions.slice(0, 2), [{ createAccount: true }, { transfer: 10n ** 22n }]);
  assert.equal(signer(key.secret).publicKeyString, key.publicKey);
  assert.deepEqual([...(first.actions[2] as any).addFullAccessKey], [...signer(key.secret).publicKey]);
});

test("onboard_registers_every_token", async () => {
  const deps = fakeDeps();
  await onboarded(deps);
  const regs = deps.near.sent.slice(1);
  assert.deepEqual(regs.map((s) => s.receiver), ["wrap.testnet", "usdc.testnet"]);
  for (const r of regs) {
    const fc = (r.actions[0] as any).functionCall;
    assert.equal(fc.method, "storage_deposit");
    assert.deepEqual(fc.args, { account_id: "kaja-coffee.op.testnet", registration_only: true });
    assert.equal(fc.deposit, 1250000000000000000000n);
  }
});

test("onboard_twice_resumes", async () => {
  const deps = fakeDeps();
  withTokens(deps);
  const cookies = await signedIn(deps);
  const key = newKey();
  deps.near.sendResults.push(() => undefined, () => ({ hash: "x", error: "boom" }));
  const first = await call(deps, "POST", "/console/onboard", { name: "Kaja Coffee", publicKey: key.publicKey }, cookies);
  assert.equal(first.status, 502);
  assert.equal(deps.db.merchantByEmail("kaja@example.com")?.step, "tokens");
  const again = await call(deps, "POST", "/console/onboard", { name: "Kaja Coffee", publicKey: key.publicKey }, cookies);
  assert.equal((again.json as any).step, "gateway");
  assert.equal(deps.near.sent.filter((s) => "createAccount" in s.actions[0]).length, 1);
});

test("onboard_key_mismatch_409", async () => {
  const deps = fakeDeps();
  const { cookies } = await onboarded(deps);
  const other = await call(deps, "POST", "/console/onboard", { name: "Kaja Coffee", publicKey: newKey().publicKey }, cookies);
  assert.equal(other.status, 409);
});

test("merchant_cap_enforced", async () => {
  const deps = fakeDeps({ maxMerchants: 1 });
  await onboarded(deps);
  const cookies = await signedIn(deps, "other@example.com");
  const res = await call(deps, "POST", "/console/onboard", { name: "Other", publicKey: newKey().publicKey }, cookies);
  assert.equal(res.status, 403);
});

test("onboard_rejects_bad_input", async () => {
  const deps = fakeDeps();
  const cookies = await signedIn(deps);
  assert.equal((await call(deps, "POST", "/console/onboard", { name: "", publicKey: newKey().publicKey }, cookies)).status, 400);
  assert.equal((await call(deps, "POST", "/console/onboard", { name: "Kaja", publicKey: "ed25519:abc" }, cookies)).status, 400);
});

test("onboard_concurrent_single_account", async () => {
  const deps = fakeDeps();
  withTokens(deps);
  const cookies = await signedIn(deps);
  const key = newKey();
  const body = { name: "Kaja Coffee", publicKey: key.publicKey };
  const [a, b] = await Promise.all([call(deps, "POST", "/console/onboard", body, cookies), call(deps, "POST", "/console/onboard", body, cookies)]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(deps.near.sent.filter((s) => "createAccount" in s.actions[0]).length, 1);
});
