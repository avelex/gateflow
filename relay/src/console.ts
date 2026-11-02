// /console/* API: demo sessions, provisioning, sponsored delegate actions, console data, fuel and retry.
import { randomBytes } from "node:crypto";
import type { Merchant } from "./db.ts";
import { decodeSignedDelegate, refusal } from "./delegate.ts";
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

const delegateParams: Handler = async (req, deps) => {
  const m = requireMerchant(req, deps);
  const key = await deps.near.accessKey(m.account_id, m.public_key);
  if (!key) throw new HttpError(409, "account key not found on chain yet");
  const head = await deps.near.head();
  return ok({ nonce: String(key.nonce + 1n), maxBlockHeight: String(head.height + 120n), publicKey: m.public_key, senderId: m.account_id, receiverId: deps.cfg.gateflow });
};

/// Calls `fund(gateway)` from the operator, attaching `amount`.
export function fund(deps: Deps, gateway: number, amount: bigint) {
  return deps.near.send(deps.cfg.gateflow, [{ functionCall: { method: "fund", args: { gateway }, gas: 30n * TGAS, deposit: amount } }]);
}

const relay: Handler = async (req, deps) => {
  const m = requireMerchant(req, deps);
  let d;
  try {
    d = decodeSignedDelegate(String(req.body?.signedDelegate ?? ""));
  } catch {
    throw new HttpError(400, "not a signed delegate action");
  }
  const reason = refusal(d, m.account_id, deps.cfg.gateflow);
  if (reason) throw new HttpError(403, reason);
  const createsGateway = d.actions.some((a) => a.kind === "functionCall" && a.method === "create_gateway");
  if (createsGateway && m.gateway_id !== null) throw new HttpError(409, "you already have a gateway");

  const r = await deps.near.send(d.senderId, [{ signedDelegate: d.raw }], deps.cfg.gateflow);
  if (r.error) throw new HttpError(422, r.error);

  if (createsGateway && typeof r.value === "number") {
    deps.db.upsertMerchant({ ...m, gateway_id: r.value, step: "done" });
    // A new gateway has no fuel; on failure the next GET /console/gateway top-up retries.
    const f = await fund(deps, r.value, deps.cfg.fuelTarget);
    if (f.error) console.error(`fund(${r.value}) failed: ${f.error}`);
  }
  return ok({ txHash: r.hash, value: r.value ?? null });
};

export const needsTopUp = (fuel: bigint, deposit: bigint) => fuel < 2n * deposit;

export type TokenMeta = { symbol: string; decimals: number };
const metaCache = new WeakMap<object, Map<string, Promise<TokenMeta>>>();

/// `ft_metadata` symbol and decimals, cached for the life of the process.
export function tokenMeta(deps: Deps, token: string): Promise<TokenMeta> {
  let cache = metaCache.get(deps.near);
  if (!cache) metaCache.set(deps.near, (cache = new Map()));
  let p = cache.get(token);
  if (!p) {
    p = deps.near.view(token, "ft_metadata", {}).then((m: any) => ({ symbol: String(m.symbol), decimals: Number(m.decimals) }));
    p.catch(() => cache.delete(token));
    cache.set(token, p);
  }
  return p;
}

function requireGateway(req: Req, deps: Deps) {
  const m = requireMerchant(req, deps);
  if (m.gateway_id === null) throw new HttpError(409, "finish onboarding first");
  return { ...m, gateway_id: m.gateway_id };
}

/// The merchant's gateway, topped up to the fuel target first when it is low.
async function readGateway(deps: Deps, id: number) {
  const g = await deps.near.view(deps.cfg.gateflow, "get_gateway", { gateway: id });
  if (!g) throw new HttpError(404, "gateway not found");
  let fuel = BigInt(g.fuel);
  if (needsTopUp(fuel, deps.cfg.executionDeposit)) {
    const r = await fund(deps, id, deps.cfg.fuelTarget - fuel);
    if (r.error) console.error(`top-up of gateway ${id} failed: ${r.error}`);
    else fuel = deps.cfg.fuelTarget;
  }
  return { ...g, fuel: String(fuel), fuelReady: !needsTopUp(fuel, deps.cfg.executionDeposit) };
}

const PAGE = 100;

/// Every `[id, item]` of a paged contract list, newest first.
async function newestFirst(deps: Deps, method: string, gateway: number, count: number): Promise<[number, any][]> {
  const out: [number, any][] = [];
  for (let end = count; end > 0; end -= PAGE) {
    const from = Math.max(0, end - PAGE);
    const page: [number, any][] = await deps.near.view(deps.cfg.gateflow, method, { gateway, from_index: from, limit: end - from });
    out.push(...page.reverse());
  }
  return out;
}

async function withMeta(deps: Deps, rows: [number, any][]) {
  return Promise.all(rows.map(async ([id, x]) => ({ id, ...x, tokenMeta: await tokenMeta(deps, x.token) })));
}

const gateway: Handler = async (req, deps) => {
  const m = requireGateway(req, deps);
  return ok({ id: m.gateway_id, ...(await readGateway(deps, m.gateway_id)) });
};

const invoices: Handler = async (req, deps) => {
  const m = requireGateway(req, deps);
  const g = await readGateway(deps, m.gateway_id);
  return ok(await withMeta(deps, await newestFirst(deps, "get_invoices", m.gateway_id, g.invoices)));
};

const payments: Handler = async (req, deps) => {
  const m = requireGateway(req, deps);
  const g = await readGateway(deps, m.gateway_id);
  return ok(await withMeta(deps, await newestFirst(deps, "get_payments", m.gateway_id, g.payments)));
};

const tokens: Handler = async (req, deps) => {
  const m = requireMerchant(req, deps);
  const list: string[] = await deps.near.view(deps.cfg.gateflow, "get_tokens", {});
  return ok(await Promise.all(list.map(async (token) => ({ token, ...(await tokenMeta(deps, token)), enabled: !m.tokens_off.includes(token) }))));
};

const preferences: Handler = async (req, deps) => {
  const m = requireMerchant(req, deps);
  const off = req.body?.tokensOff;
  const list: string[] = await deps.near.view(deps.cfg.gateflow, "get_tokens", {});
  if (!Array.isArray(off) || !off.every((t) => typeof t === "string" && list.includes(t))) {
    throw new HttpError(400, "tokensOff must list allowlisted tokens");
  }
  deps.db.upsertMerchant({ ...m, tokens_off: [...new Set(off as string[])] });
  return ok({ tokensOff: off });
};

const retry: Handler = async (req, deps) => {
  const m = requireGateway(req, deps);
  const id = req.body?.payment;
  if (!Number.isSafeInteger(id) || id < 0) throw new HttpError(400, "payment must be an id");
  const p = await deps.near.view(deps.cfg.gateflow, "get_payment", { payment: id });
  if (!p || p.gateway !== m.gateway_id) throw new HttpError(403, "not a payment of your gateway");
  if (p.status !== "SettleFailed" && p.status !== "RefundFailed") throw new HttpError(403, "only failed payments can be retried");
  const r = await deps.near.send(deps.cfg.gateflow, [{ functionCall: { method: "retry", args: { payment: id }, gas: 50n * TGAS, deposit: 0n } }]);
  if (r.error) throw new HttpError(422, r.error);
  return ok({ txHash: r.hash });
};

export const consoleRoutes: Record<string, Handler> = {
  "POST /console/session": signIn,
  "DELETE /console/session": signOut,
  "GET /console/me": me,
  "POST /console/onboard": onboard,
  "GET /console/delegate-params": delegateParams,
  "POST /console/relay": relay,
  "GET /console/gateway": gateway,
  "GET /console/invoices": invoices,
  "GET /console/payments": payments,
  "GET /console/tokens": tokens,
  "PUT /console/preferences": preferences,
  "POST /console/retry": retry,
};
