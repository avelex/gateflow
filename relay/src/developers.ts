// /console/* Developers settings: API keys, the signer key state, webhook and allowed origins.
import { keyHash, newApiKey } from "./api.ts";
import { requireMerchant } from "./console.ts";
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

export const developerRoutes: Record<string, Handler> = {
  "GET /console/api-keys": listKeys,
  "POST /console/api-keys": createKey,
  "DELETE /console/api-keys": revokeKey,
};
