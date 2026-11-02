// /console/* API: demo sessions, provisioning, sponsored delegate actions, console data, fuel and retry.
import { randomBytes } from "node:crypto";
import type { Merchant } from "./db.ts";
import { type Deps, type Handler, HttpError, ok, type Req } from "./types.ts";

export const SESSION_COOKIE = "gateflow_session";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cookieHeader(deps: Deps, value: string, maxAge?: number): Record<string, string> {
  let c = `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/`;
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  if (deps.cfg.publicUrl.startsWith("https:")) c += "; Secure";
  return { "set-cookie": c };
}

/// The session's email, or 401.
export function requireSession(req: Req, deps: Deps): string {
  const token = req.cookies[SESSION_COOKIE];
  const email = token ? deps.db.sessionEmail(token) : undefined;
  if (!email) throw new HttpError(401, "sign in first");
  return email;
}

/// The session's merchant with a provisioned account, or 401 / 409.
export function requireMerchant(req: Req, deps: Deps): Merchant & { account_id: string; public_key: string } {
  const m = deps.db.merchantByEmail(requireSession(req, deps));
  if (!m?.account_id || !m.public_key) throw new HttpError(409, "finish onboarding first");
  return m as Merchant & { account_id: string; public_key: string };
}

const signIn: Handler = async (req, deps) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) throw new HttpError(400, "not a valid email");
  const token = randomBytes(32).toString("hex");
  deps.db.createSession(token, email, deps.now());
  return ok({ step: deps.db.merchantByEmail(email)?.step ?? "account" }, cookieHeader(deps, token));
};

const signOut: Handler = async (req, deps) => {
  const token = req.cookies[SESSION_COOKIE];
  if (token) deps.db.deleteSession(token);
  return ok({}, cookieHeader(deps, "", 0));
};

const me: Handler = async (req, deps) => {
  const email = requireSession(req, deps);
  const m = deps.db.merchantByEmail(email);
  return ok({ email, name: m?.name ?? null, accountId: m?.account_id ?? null, gatewayId: m?.gateway_id ?? null, step: m?.step ?? "account" });
};

export const consoleRoutes: Record<string, Handler> = {
  "POST /console/session": signIn,
  "DELETE /console/session": signOut,
  "GET /console/me": me,
};
