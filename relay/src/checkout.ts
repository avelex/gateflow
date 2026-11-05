// /checkout/* API: public invoice details, quotable assets, 1Click quotes with a `ref`, status and deferred screening.
import { randomBytes } from "node:crypto";
import { ensureRegistered, tokenMeta } from "./console.ts";
import { activeVersion, evidenceFor, opensPayment } from "./screening.ts";
import { type Deps, type Handler, HttpError, ok } from "./types.ts";

const TGAS = 10n ** 12n;
const NEAR_ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const REF = /^[0-9a-f]{32}$/;
const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const QUOTE_TTL_MS = 30 * 60 * 1000;

export const isNearAccount = (s: unknown): s is string => typeof s === "string" && s.length >= 2 && s.length <= 64 && NEAR_ACCOUNT.test(s);

/// The 1Click `/v0/quote` body: an EXACT_OUTPUT swap delivering `amount` of `destinationAsset` to the Gateflow contract.
export function quoteRequest(p: {
  invoiceId: number;
  amount: string;
  originAsset: string;
  destinationAsset: string;
  refundTo: string;
  refundOnNear: string;
  ref: string;
  recipient: string;
  deadlineMs: number;
  dry: boolean;
}): object {
  return {
    dry: p.dry,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 100,
    originAsset: p.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: p.destinationAsset,
    amount: p.amount,
    refundTo: p.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: p.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(p.deadlineMs).toISOString(),
    customRecipientMsg: JSON.stringify({ invoice: p.invoiceId, ref: p.ref, refund_to: p.refundOnNear }),
  };
}

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
  // A payout account without storage on the token would fail the settle.
  const g = await deps.near.view(deps.cfg.gateflow, "get_gateway", { gateway: inv.gateway });
  if (g) await ensureRegistered(deps, g.payout_to, inv.token);
  const meta = await tokenMeta(deps, inv.token);
  const payment = inv.payment === null || inv.payment === undefined ? null : await deps.near.view(deps.cfg.gateflow, "get_payment", { payment: inv.payment });
  const screening = payment ? await evidenceFor(deps, inv.payment, payment.status) : null;
  const seen = payment?.ref ? deps.db.quoteByRef(payment.ref)?.deposit_seen_ms : null;
  return ok({
    id,
    gateway: inv.gateway,
    merchant: deps.db.merchantByGateway(inv.gateway)?.name ?? null,
    contract: deps.cfg.gateflow,
    token: inv.token,
    symbol: meta.symbol,
    decimals: meta.decimals,
    amount: inv.amount,
    memo: inv.memo ?? null,
    expiresAtSec: inv.expires_at_sec,
    status: inv.status,
    payment: payment && { id: inv.payment, status: payment.status, refundTo: payment.refund_to },
    enclave: { project: deps.cfg.outlayerProject, activeVersion: await activeVersion(deps) },
    screening,
    times: {
      depositSeenAtSec: seen === null || seen === undefined ? null : Math.floor(seen / 1000),
      openedAtSec: payment?.opened_at_sec ?? null,
      screenedAtSec: screening?.screenedAtSec ?? null,
      closedAtSec: screening?.closedAtSec ?? null,
    },
  });
};

/// Records the payer's wallet tx as its payment's screening tx, once RPC shows it opened that payment.
const reportTx: Handler = async (req, deps) => {
  const id = invoiceId(req.body?.invoice);
  const hash = req.body?.txHash;
  if (typeof hash !== "string" || !TX_HASH.test(hash)) throw new HttpError(400, "txHash must be a NEAR transaction hash");
  const inv = await deps.near.view(deps.cfg.gateflow, "get_invoice", { invoice: id });
  if (!inv) throw new HttpError(404, "invoice not found");
  if (inv.payment === null || inv.payment === undefined) throw new HttpError(404, "invoice has no payment yet");
  const payment = await deps.near.view(deps.cfg.gateflow, "get_payment", { payment: inv.payment });
  if (!payment) throw new HttpError(404, "payment not found");
  // Not final yet, or not signed by the payer: the page retries on 404.
  const tx = await deps.near.tx(hash, payment.payer);
  if (!tx) throw new HttpError(404, "transaction not found");
  if (!opensPayment(tx, deps.cfg.gateflow, inv.payment)) throw new HttpError(422, "transaction did not open this payment");
  deps.db.recordScreening(inv.payment, hash, payment.payer);
  return ok({ payment: inv.payment });
};

export type Asset = { assetId: string; chain: string; symbol: string; decimals: number };

const asAsset = (t: any): Asset => ({ assetId: t.assetId, chain: t.blockchain, symbol: t.symbol, decimals: t.decimals });

/// Screenable origin assets that are the same asset as NEAR token `token`: equal 1Click `coingeckoId` and symbol,
/// the first per chain in 1Click order. Empty when 1Click does not deliver `token`.
export function sameAssets(tokens: any[], token: string, evmChains: string[]): Asset[] {
  const dest = tokens.find((t) => t.assetId === destinationAsset(tokens, token));
  if (!dest?.coingeckoId) return [];
  const seen = new Set<string>();
  return tokens
    .filter((t) => screenable(t.blockchain, evmChains) && t.coingeckoId === dest.coingeckoId && t.symbol === dest.symbol)
    .filter((t) => !seen.has(t.blockchain) && seen.add(t.blockchain))
    .map(asAsset);
}

/// Without `invoice`, every screenable asset (the console's chain list); with it, only that invoice's asset.
const assets: Handler = async (req, deps) => {
  const tokens = await deps.oneclick.tokens();
  if (!req.query.has("invoice")) return ok(tokens.filter((t) => screenable(t.blockchain, deps.cfg.evmChains)).map(asAsset));
  const inv = await deps.near.view(deps.cfg.gateflow, "get_invoice", { invoice: invoiceId(req.query.get("invoice")) });
  if (!inv) throw new HttpError(404, "invoice not found");
  return ok(sameAssets(tokens, inv.token, deps.cfg.evmChains));
};

const quote: Handler = async (req, deps) => {
  const b = req.body ?? {};
  const id = invoiceId(b.invoice);
  if (!isNearAccount(b.refundOnNear)) throw new HttpError(400, "not a NEAR account id");
  if (typeof b.refundTo !== "string" || !b.refundTo || b.refundTo.length > 128) throw new HttpError(400, "refundTo must be an origin-chain address");
  if (typeof b.originAsset !== "string" || !b.originAsset) throw new HttpError(400, "originAsset is required");

  const inv = await deps.near.view(deps.cfg.gateflow, "get_invoice", { invoice: id });
  if (!inv) throw new HttpError(404, "invoice not found");
  const expiresMs = inv.expires_at_sec * 1000;
  if (inv.status !== "Open" || expiresMs <= deps.now()) throw new HttpError(409, "invoice is not payable");

  const tokens = await deps.oneclick.tokens();
  const chain = originChain(tokens, b.originAsset);
  if (!screenable(chain, deps.cfg.evmChains)) throw new HttpError(422, "this origin chain can't be screened");
  const destination = destinationAsset(tokens, inv.token);
  if (!destination) throw new HttpError(502, "gateway token not deliverable by 1Click");
  if (!sameAssets(tokens, inv.token, deps.cfg.evmChains).some((a) => a.assetId === b.originAsset)) throw new HttpError(422, "originAsset is not this invoice's asset");

  const ref = randomBytes(16).toString("hex");
  const deadlineMs = Math.min(deps.now() + QUOTE_TTL_MS, expiresMs);
  const body = quoteRequest({
    invoiceId: id,
    amount: inv.amount,
    originAsset: b.originAsset,
    destinationAsset: destination,
    refundTo: b.refundTo,
    refundOnNear: b.refundOnNear,
    ref,
    recipient: deps.cfg.gateflow,
    deadlineMs,
    dry: false,
  });
  const reply = await deps.oneclick.quote(body);
  const q = reply?.quote;
  if (!q?.depositAddress) throw new HttpError(502, "1Click returned no deposit address");
  const deadline = q.deadline ?? new Date(deadlineMs).toISOString();
  deps.db.insertQuote({ ref, invoice: id, deposit_address: q.depositAddress, deadline_ms: Date.parse(deadline) || deadlineMs, origin_chain: chain });
  return ok({ ref, depositAddress: q.depositAddress, depositMemo: q.depositMemo ?? null, amountIn: q.amountIn, amountInFormatted: q.amountInFormatted ?? null, deadline });
};

function depositAddressOf(raw: unknown): string {
  if (typeof raw !== "string" || !raw || raw.length > 128) throw new HttpError(400, "depositAddress is required");
  return raw;
}

const status: Handler = async (req, deps) => {
  const addr = depositAddressOf(req.query.get("depositAddress"));
  const st = await deps.oneclick.status(addr);
  return ok({ status: st?.status ?? "UNKNOWN", screening: deps.db.quoteByDeposit(addr)?.screened === 1 });
};

/// Sends `screen_intents` from the relay account and records its tx. "screening already started" counts as done.
export async function submitScreening(deps: Deps, ref: string, payment: number, depositAddress: string): Promise<{ txHash: string | null }> {
  const r = await deps.near.send(deps.cfg.gateflow, [
    { functionCall: { method: "screen_intents", args: { payment, deposit_address: depositAddress }, gas: 300n * TGAS, deposit: 0n } },
  ]);
  if (r.error && !r.error.includes("screening already started")) throw new HttpError(422, r.error);
  deps.db.markQuote(ref, { status: "SUCCESS", screened: true });
  if (!r.error) deps.db.recordScreening(payment, r.hash, deps.cfg.accountId);
  return { txHash: r.error ? null : r.hash };
}

const screen: Handler = async (req, deps) => {
  const ref = req.body?.ref;
  if (typeof ref !== "string" || !REF.test(ref)) throw new HttpError(400, "ref must be 32 lowercase hex characters");
  const addr = depositAddressOf(req.body?.depositAddress);
  const found = await deps.near.view(deps.cfg.gateflow, "get_payment_by_ref", { reference: ref });
  if (!found) throw new HttpError(404, "no payment for this ref yet");
  const st = await deps.oneclick.status(addr);
  if (st?.status !== "SUCCESS") throw new HttpError(409, String(st?.status ?? "UNKNOWN"));
  const [payment] = found;
  return ok({ payment, ...(await submitScreening(deps, ref, payment, addr)) });
};

export const checkoutRoutes: Record<string, Handler> = {
  "GET /checkout/invoice": invoice,
  "GET /checkout/assets": assets,
  "POST /checkout/quote": quote,
  "GET /checkout/status": status,
  "POST /checkout/screen": screen,
  "POST /checkout/tx": reportTx,
};
