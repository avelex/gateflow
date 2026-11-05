// /console/* Developers settings: API keys, the signer key state, webhook and allowed origins.
import { keyHash, newApiKey, newWebhookSecret } from "./api.ts";
import { requireGateway, requireMerchant, signerPublicKey } from "./console.ts";
import { SIGNER_ALLOWANCE, SIGNER_METHODS } from "./delegate.ts";
import { type Deps, type Handler, HttpError, ok } from "./types.ts";

export const isTestnet = (deps: Deps) => deps.cfg.gateflow.endsWith(".testnet");

const listKeys: Handler = async (req, deps) => {
  const m = requireMerchant(req, deps);
  return ok(deps.db.apiKeys(m.email).map((k) => ({ id: k.hash.slice(0, 12), label: k.label, last4: k.last4, createdAt: k.created_at })));
};

const createKey: Handler = async (req, deps) => {
  const m = requireMerchant(req, deps);
  const label = String(req.body?.label ?? "").trim();
  if (!label || label.length > 40) throw new HttpError(400, "label must be 1 to 40 characters");
  const key = newApiKey(isTestnet(deps));
  deps.db.addApiKey({ hash: keyHash(key), email: m.email, label, last4: key.slice(-4), created_at: deps.now() });
  return ok({ key });
};

const revokeKey: Handler = async (req, deps) => {
  const m = requireMerchant(req, deps);
  const id = req.query.get("id") ?? "";
  if (!/^[0-9a-f]{12}$/.test(id) || !deps.db.revokeApiKey(m.email, id, deps.now())) throw new HttpError(404, "no such key");
  return ok({ revoked: id });
};

/// Whether the merchant's account holds the invoice signer key.
export async function apiEnabled(deps: Deps, account: string): Promise<boolean> {
  const pub = signerPublicKey(deps);
  return !!pub && (await deps.near.accessKey(account, pub)) !== undefined;
}

const dev: Handler = async (req, deps) => {
  const m = requireMerchant(req, deps);
  const pub = signerPublicKey(deps);
  return ok({
    available: !!pub,
    enabled: await apiEnabled(deps, m.account_id),
    signerPublicKey: pub ?? null,
    allowance: SIGNER_ALLOWANCE === null ? null : SIGNER_ALLOWANCE.toString(),
    receiver: deps.cfg.gateflow,
    methods: SIGNER_METHODS,
    webhookUrl: m.gateway_id === null ? null : deps.db.gatewayDev(m.gateway_id).webhook_url,
    origins: m.gateway_id === null ? [] : deps.db.gatewayDev(m.gateway_id).origins,
  });
};

const MAX_ORIGINS = 10;

/// `https://host[:port]` exactly, or `http://localhost[:port]` on testnet.
export function validOrigin(o: unknown, testnet: boolean): o is string {
  if (typeof o !== "string") return false;
  let u: URL;
  try {
    u = new URL(o);
  } catch {
    return false;
  }
  const local = testnet && u.protocol === "http:" && u.hostname === "localhost";
  return (u.protocol === "https:" || local) && u.origin === o && /^[a-z0-9.-]+$/.test(u.hostname);
}

const putWebhook: Handler = async (req, deps) => {
  const gateway = requireGateway(req, deps).gateway_id;
  const url = req.body?.url ?? null;
  if (url === null) {
    deps.db.setWebhook(gateway, null, null);
    return ok({ url: null });
  }
  let u: URL | undefined;
  try {
    u = new URL(String(url));
  } catch {}
  if (u?.protocol !== "https:") throw new HttpError(400, "webhook URL must start with https://");
  const secret = newWebhookSecret();
  deps.db.setWebhook(gateway, u.toString(), secret);
  return ok({ url: u.toString(), secret });
};

const rollSecret: Handler = async (req, deps) => {
  const gateway = requireGateway(req, deps).gateway_id;
  const { webhook_url } = deps.db.gatewayDev(gateway);
  if (!webhook_url) throw new HttpError(409, "set a webhook URL first");
  const secret = newWebhookSecret();
  deps.db.setWebhook(gateway, webhook_url, secret);
  return ok({ secret });
};

const putOrigins: Handler = async (req, deps) => {
  const gateway = requireGateway(req, deps).gateway_id;
  const list = req.body?.origins;
  if (!Array.isArray(list) || list.length > MAX_ORIGINS || !list.every((o) => validOrigin(o, isTestnet(deps))))
    throw new HttpError(400, `origins must be up to ${MAX_ORIGINS} entries like https://shop.example`);
  const origins = [...new Set(list as string[])];
  deps.db.setOrigins(gateway, origins);
  return ok({ origins });
};

export const developerRoutes: Record<string, Handler> = {
  "GET /console/dev": dev,
  "GET /console/api-keys": listKeys,
  "POST /console/api-keys": createKey,
  "DELETE /console/api-keys": revokeKey,
  "PUT /console/webhook": putWebhook,
  "POST /console/webhook/secret": rollSecret,
  "PUT /console/origins": putOrigins,
};
