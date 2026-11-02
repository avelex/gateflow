// /console/* API: demo sessions, provisioning, sponsored delegate actions, console data, fuel and retry.
import { randomBytes } from "node:crypto";
import type { Merchant } from "./db.ts";
import { base58decode, publicKeyBytes } from "./near.ts";
import { type Deps, type Handler, HttpError, ok, type Req } from "./types.ts";

const TGAS = 10n ** 12n;
export const ACCOUNT_FUNDING = 10n ** 22n; // 0.01 NEAR: storage for the account and its key

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

/// Account-name slug: lowercase, non-`[a-z0-9]` runs to `-`, at most 32 characters, `merchant` when empty.
export function slug(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");
  return s || "merchant";
}

const PUBLIC_KEY = /^ed25519:[1-9A-HJ-NP-Za-km-z]+$/;

function validPublicKey(pk: unknown): pk is string {
  if (typeof pk !== "string" || !PUBLIC_KEY.test(pk)) return false;
  try {
    return base58decode(pk.slice(8)).length === 32;
  } catch {
    return false;
  }
}

const locks = new Map<string, Promise<unknown>>();

/// Runs `fn` after every earlier call for the same key has finished.
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => {});
  locks.set(key, tail);
  tail.then(() => locks.get(key) === tail && locks.delete(key));
  return next;
}

async function freeAccountId(base: string, deps: Deps): Promise<string> {
  for (let n = 1; n <= 20; n++) {
    const id = `${n === 1 ? base : `${base}-${n}`}.${deps.cfg.accountId}`;
    if (!(await deps.near.accountExists(id))) return id;
  }
  throw new HttpError(409, "no free account name, try another business name");
}

function failIfError(r: { error?: string }, what: string) {
  if (r.error) throw new HttpError(502, `${what} failed: ${r.error}`);
}

const onboard: Handler = async (req, deps) => {
  const email = requireSession(req, deps);
  const name = String(req.body?.name ?? "").trim();
  const publicKey = req.body?.publicKey;
  if (!name || name.length > 64) throw new HttpError(400, "business name must be 1 to 64 characters");
  if (!validPublicKey(publicKey)) throw new HttpError(400, "not an ed25519 public key");

  return withLock(email, async () => {
    let m = deps.db.merchantByEmail(email);
    if (!m) {
      if (deps.db.merchantCount() >= deps.cfg.maxMerchants) throw new HttpError(403, "merchant limit reached");
      m = { email, name, account_id: null, public_key: publicKey, gateway_id: null, step: "account", tokens_off: [] };
    } else if (m.account_id && m.public_key !== publicKey) {
      throw new HttpError(409, "this account is owned by a different passkey");
    }

    if (m.step === "account") {
      const id = await freeAccountId(slug(name), deps);
      const r = await deps.near.send(id, [{ createAccount: true }, { transfer: ACCOUNT_FUNDING }, { addFullAccessKey: publicKeyBytes(publicKey) }]);
      failIfError(r, "account creation");
      m = { ...m, name, public_key: publicKey, account_id: id, step: "tokens" };
      deps.db.upsertMerchant(m);
    }

    if (m.step === "tokens") {
      const tokens: string[] = await deps.near.view(deps.cfg.gateflow, "get_tokens", {});
      for (const token of tokens) {
        const bounds = await deps.near.view(token, "storage_balance_bounds", {});
        const r = await deps.near.send(token, [
          { functionCall: { method: "storage_deposit", args: { account_id: m.account_id, registration_only: true }, gas: 30n * TGAS, deposit: BigInt(bounds.min) } },
        ]);
        failIfError(r, `storage registration on ${token}`);
      }
      m = { ...m, step: "gateway" };
      deps.db.upsertMerchant(m);
    }

    return ok({ step: m.step, accountId: m.account_id });
  });
};

export const consoleRoutes: Record<string, Handler> = {
  "POST /console/session": signIn,
  "DELETE /console/session": signOut,
  "GET /console/me": me,
  "POST /console/onboard": onboard,
};
