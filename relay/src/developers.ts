// /console/* Developers settings: API keys, the signer key state, webhook and allowed origins.
import { keyHash, newApiKey } from "./api.ts";
import { requireMerchant, signerPublicKey } from "./console.ts";
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
  });
};

export const developerRoutes: Record<string, Handler> = {
  "GET /console/dev": dev,
  "GET /console/api-keys": listKeys,
  "POST /console/api-keys": createKey,
  "DELETE /console/api-keys": revokeKey,
};
