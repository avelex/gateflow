// /checkout/* API: public invoice details, quotable assets, 1Click quotes with a `ref`, status and deferred screening.
import { tokenMeta } from "./console.ts";
import { type Handler, HttpError, ok } from "./types.ts";

/// The NEAR-delivered 1Click asset for a NEP-141 token, preferring the `1cs_v1:near:` form.
export function destinationAsset(tokens: any[], token: string): string | undefined {
  const near = tokens.filter((t) => t.blockchain === "near" && (t.assetId === `nep141:${token}` || String(t.assetId).endsWith(`:nep141:${token}`)));
  return (near.find((t) => String(t.assetId).startsWith("1cs_v1:near:")) ?? near[0])?.assetId;
}

export const originChain = (tokens: any[], assetId: string): string | undefined => tokens.find((t) => t.assetId === assetId)?.blockchain;

export const screenable = (chain: string | undefined, evmChains: string[]) => !!chain && (evmChains.includes(chain) || chain === "btc" || chain === "zec");

function invoiceId(raw: unknown): number {
  const n = Number(raw);
  if (raw === null || raw === undefined || raw === "" || !Number.isSafeInteger(n) || n < 0) throw new HttpError(400, "invoice must be an id");
  return n;
}

const invoice: Handler = async (req, deps) => {
  const id = invoiceId(req.query.get("id"));
  const inv = await deps.near.view(deps.cfg.gateflow, "get_invoice", { invoice: id });
  if (!inv) throw new HttpError(404, "invoice not found");
  const meta = await tokenMeta(deps, inv.token);
  const payment = inv.payment === null || inv.payment === undefined ? null : await deps.near.view(deps.cfg.gateflow, "get_payment", { payment: inv.payment });
  return ok({
    id,
    gateway: inv.gateway,
    merchant: deps.db.merchantByGateway(inv.gateway)?.name ?? null,
    token: inv.token,
    symbol: meta.symbol,
    decimals: meta.decimals,
    amount: inv.amount,
    memo: inv.memo ?? null,
    expiresAtSec: inv.expires_at_sec,
    status: inv.status,
    payment: payment && { id: inv.payment, status: payment.status, refundTo: payment.refund_to },
  });
};

const assets: Handler = async (_req, deps) => {
  const tokens = await deps.oneclick.tokens();
  return ok(
    tokens
      .filter((t) => screenable(t.blockchain, deps.cfg.evmChains))
      .map((t) => ({ assetId: t.assetId, chain: t.blockchain, symbol: t.symbol, decimals: t.decimals })),
  );
};

export const checkoutRoutes: Record<string, Handler> = {
  "GET /checkout/invoice": invoice,
  "GET /checkout/assets": assets,
};
