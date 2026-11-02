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
