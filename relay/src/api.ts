// The merchant API: keys, amounts and the HTTP routes a shop server calls.
import { createHash, randomBytes } from "node:crypto";
import { signerPublicKey, tokenMeta, withLock } from "./console.ts";
import type { Merchant } from "./db.ts";
import { signDelegate } from "./delegate.ts";
import { signer } from "./near.ts";
import { type Deps, type Handler, HttpError, type Req, type Res } from "./types.ts";

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/// 32 random bytes in base62, padded to the 43 characters 2^256 needs.
function base62(bytes: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = B62[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out.padStart(43, "0");
}

export const newApiKey = (testnet: boolean) => `${testnet ? "gf_test_" : "gf_live_"}${base62(randomBytes(32))}`;
export const keyHash = (key: string) => createHash("sha256").update(key).digest("hex");
export const newWebhookSecret = () => `whsec_${base62(randomBytes(32))}`;

/// Raw token units of a positive decimal string; throws on zero, a sign, an exponent or more decimals than the token has.
export function toRaw(amount: string, decimals: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!m || (m[2]?.length ?? 0) > decimals) throw new Error("amount must be a positive decimal within the token's precision");
  const raw = BigInt(m[1] + (m[2] ?? "").padEnd(decimals, "0"));
  if (raw === 0n) throw new Error("amount must be positive");
  return raw;
}

/// Decimal string of raw units, with at least two decimals for amounts like `10.00`.
export function fromRaw(raw: bigint, decimals: number): string {
  const s = raw.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "").padEnd(Math.min(2, decimals), "0");
  return frac ? `${whole}.${frac}` : whole;
}

export type ApiStatus = "open" | "paying" | "paid" | "returned" | "expired";
export type ChainInvoice = { gateway: number; token: string; amount: string; expires_at_sec: number; memo: string | null; status: string; payment: number | null };

export function apiStatus(inv: Pick<ChainInvoice, "status" | "expires_at_sec">, nowMs: number): ApiStatus {
  if (inv.status === "Open") return nowMs >= inv.expires_at_sec * 1000 ? "expired" : "open";
  return inv.status.toLowerCase() as ApiStatus;
}

/// The invoice as the API, webhooks and the widget show it.
export function invoiceObject(id: number, inv: ChainInvoice, meta: { symbol: string; decimals: number }, publicUrl: string, nowMs: number) {
  return {
    id,
    url: `${publicUrl.replace(/\/$/, "")}/pay/${id}`,
    status: apiStatus(inv, nowMs),
    amount: fromRaw(BigInt(inv.amount), meta.decimals),
    currency: meta.symbol,
    order_id: inv.memo,
    expires_at: new Date(inv.expires_at_sec * 1000).toISOString(),
  };
}

const TGAS = 10n ** 12n;
export const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const DEFAULT_EXPIRY_SEC = 1800;
const MIN_EXPIRY_SEC = 60;
const MAX_EXPIRY_SEC = 2_592_000;
const MAX_MEMO_BYTES = 140;

const fieldError = (field: string, error: string): Res => ({ status: 422, json: { error, field } });

/// The merchant whose live API key is the Bearer token, or 401.
function apiMerchant(req: Req, deps: Deps): Merchant & { account_id: string; gateway_id: number } {
  const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1];
  const m = token ? deps.db.merchantByKeyHash(keyHash(token)) : undefined;
  if (!m?.account_id || m.gateway_id === null) throw new HttpError(401, "invalid API key");
  return m as Merchant & { account_id: string; gateway_id: number };
}

// ponytail: in-memory window per relay process; move to the DB if the relay ever runs as several instances.
const windows = new WeakMap<Deps["db"], Map<number, number[]>>();

/// Records one creation for `gateway`, or returns the seconds until the window has room.
function rateLimited(deps: Deps, gateway: number): number | undefined {
  let byGateway = windows.get(deps.db);
  if (!byGateway) windows.set(deps.db, (byGateway = new Map()));
  const now = deps.now();
  const recent = (byGateway.get(gateway) ?? []).filter((t) => t > now - RATE_WINDOW_MS);
  byGateway.set(gateway, recent);
  if (recent.length >= RATE_LIMIT) return Math.max(1, Math.ceil((recent[0] + RATE_WINDOW_MS - now) / 1000));
  recent.push(now);
  return undefined;
}

/// The allowlisted token the merchant accepts under display symbol `currency`.
async function tokenFor(deps: Deps, m: Merchant, currency: string) {
  const tokens: string[] = await deps.near.view(deps.cfg.gateflow, "get_tokens", {});
  for (const token of tokens) {
    if (m.tokens_off.includes(token)) continue;
    const meta = await tokenMeta(deps, token);
    if (meta.symbol === currency) return { token, meta };
  }
  return undefined;
}

/// Signs `create_invoice` as `account` with the invoice signer key and relays it; the new invoice id.
async function signerCreate(deps: Deps, account: string, args: object): Promise<number> {
  const secret = deps.cfg.invoiceSigner!;
  const s = signer(secret);
  for (let attempt = 0; ; attempt++) {
    const key = await deps.near.accessKey(account, s.publicKeyString);
    if (!key) throw new HttpError(409, "API is not enabled");
    const head = await deps.near.head();
    const actions = [{ functionCall: { method: "create_invoice", args, gas: 30n * TGAS, deposit: 0n } }];
    const sd = signDelegate({ senderId: account, receiverId: deps.cfg.gateflow, actions, nonce: key.nonce + 1n, maxBlockHeight: head.height + 120n, publicKey: s.publicKey }, secret);
    const r = await deps.near.send(account, [{ signedDelegate: Buffer.from(sd, "base64") }], deps.cfg.gateflow);
    if (r.error && attempt === 0 && /InvalidNonce/.test(r.error)) continue;
    if (r.error) throw new HttpError(502, `create_invoice failed: ${r.error}`);
    if (typeof r.value !== "number") throw new HttpError(502, "create_invoice returned no id");
    return r.value;
  }
}

async function readInvoice(deps: Deps, id: number) {
  const inv: ChainInvoice | null = await deps.near.view(deps.cfg.gateflow, "get_invoice", { invoice: id });
  if (!inv) return undefined;
  return invoiceObject(id, inv, await tokenMeta(deps, inv.token), deps.cfg.publicUrl, deps.now());
}

const createInvoice: Handler = async (req, deps) => {
  const m = apiMerchant(req, deps);
  const b = req.body ?? {};
  if (typeof b.currency !== "string") return fieldError("currency", "currency is required");
  const found = await tokenFor(deps, m, b.currency);
  if (!found) return fieldError("currency", `currency ${b.currency} is not accepted`);
  let raw: bigint;
  try {
    raw = toRaw(typeof b.amount === "string" ? b.amount : "", found.meta.decimals);
  } catch (e) {
    return fieldError("amount", (e as Error).message);
  }
  const orderId: string | null = b.order_id ?? null;
  if (orderId !== null && (typeof orderId !== "string" || !orderId || Buffer.byteLength(orderId) > MAX_MEMO_BYTES))
    return fieldError("order_id", `order_id must be a string of 1 to ${MAX_MEMO_BYTES} bytes`);
  const expiresIn = b.expires_in_sec ?? DEFAULT_EXPIRY_SEC;
  if (!Number.isInteger(expiresIn) || expiresIn < MIN_EXPIRY_SEC || expiresIn > MAX_EXPIRY_SEC)
    return fieldError("expires_in_sec", `expires_in_sec must be an integer from ${MIN_EXPIRY_SEC} to ${MAX_EXPIRY_SEC}`);
  if (!signerPublicKey(deps) || !(await deps.near.accessKey(m.account_id, signerPublicKey(deps)!))) throw new HttpError(409, "API is not enabled");

  return withLock(m.account_id, async () => {
    if (orderId !== null) {
      for (const row of deps.db.apiInvoicesByOrder(m.gateway_id, orderId)) {
        if (row.expires_at_ms <= deps.now()) continue;
        const inv = await readInvoice(deps, row.invoice);
        if (inv?.status === "open") return { status: 200, json: inv };
      }
    }
    const wait = rateLimited(deps, m.gateway_id);
    if (wait !== undefined) return { status: 429, json: { error: "rate limit: 60 invoices per minute" }, headers: { "retry-after": String(wait) } };
    const args = { gateway: m.gateway_id, token: found.token, amount: raw.toString(), expires_in_sec: expiresIn, memo: orderId ?? undefined };
    const id = await signerCreate(deps, m.account_id, args);
    const expiresAtSec = Math.floor(deps.now() / 1000) + expiresIn;
    deps.db.insertApiInvoice({ invoice: id, gateway: m.gateway_id, order_id: orderId, expires_at_ms: expiresAtSec * 1000 });
    const inv: ChainInvoice = { gateway: m.gateway_id, token: found.token, amount: raw.toString(), expires_at_sec: expiresAtSec, memo: orderId, status: "Open", payment: null };
    return { status: 201, json: invoiceObject(id, inv, found.meta, deps.cfg.publicUrl, deps.now()) };
  });
};

const getInvoice: Handler = async (req, deps) => {
  const m = apiMerchant(req, deps);
  const id = Number(req.path.split("/").pop());
  const inv: ChainInvoice | null = await deps.near.view(deps.cfg.gateflow, "get_invoice", { invoice: id });
  if (!inv || inv.gateway !== m.gateway_id) throw new HttpError(404, "invoice not found");
  return { status: 200, json: invoiceObject(id, inv, await tokenMeta(deps, inv.token), deps.cfg.publicUrl, deps.now()) };
};

export const apiRoutes: Record<string, Handler> = {
  "POST /api/v1/invoices": createInvoice,
  "GET /api/v1/invoices/:id": getInvoice,
};
