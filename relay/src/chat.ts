// The console assistant: model client, tools and the bounded tool loop (design decisions 2 to 9).
import { newestFirst, readGateway, tokenMeta, type TokenMeta, withMeta } from "./console.ts";
import type { Merchant } from "./db.ts";
import type { Completion, Config, Deps, Llm, ToolDef } from "./types.ts";

/// OpenAI-compatible `/chat/completions` client over plain fetch. Tool schemas carry no `strict` flag.
export function llmClient(cfg: Pick<Config, "llmBaseUrl" | "llmApiKey" | "llmModel">): Llm {
  return {
    async complete(messages, tools) {
      const res = await fetch(`${cfg.llmBaseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.llmApiKey}` },
        body: JSON.stringify({ model: cfg.llmModel, messages, tools: tools.map((t) => ({ type: "function", function: t })) }),
      });
      if (!res.ok) throw new Error(`model endpoint ${res.status}`);
      const msg = (await res.json())?.choices?.[0]?.message;
      if (!msg) throw new Error("model returned no message");
      const out: Completion = { content: msg.content ?? undefined };
      if (msg.tool_calls?.length) {
        out.toolCalls = msg.tool_calls.map((c: any) => ({ id: String(c.id), name: String(c.function?.name), arguments: String(c.function?.arguments ?? "") }));
      }
      return out;
    },
  };
}

export type GatewayMerchant = Merchant & { gateway_id: number };
/// A tool: its schema for the model, its trace group, and its handler. Handlers return `{ error }` instead of throwing.
export type Tool = ToolDef & { group: string; run(args: any, m: GatewayMerchant, threadId: number): Promise<unknown> };

/// Raw token units as a decimal string, trailing zeros trimmed (same rule as web/src/format.ts).
export function formatAmount(raw: bigint, decimals: number): string {
  const s = raw.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/// Decimal text to raw units. Throws on non-digits, more than `decimals` fraction digits, or zero (same rule as web/src/format.ts).
export function parseAmount(text: string, decimals: number): bigint {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(text.trim());
  if (!m || !(m[1] || m[2])) throw new Error("enter an amount");
  const frac = m[2] ?? "";
  if (frac.length > decimals) throw new Error(`at most ${decimals} decimals`);
  const raw = BigInt((m[1] || "0") + frac.padEnd(decimals, "0"));
  if (raw === 0n) throw new Error("amount must be above zero");
  return raw;
}

const iso = (sec: number) => new Date(sec * 1000).toISOString();
const decimal = (x: { amount: string; tokenMeta: TokenMeta }) => formatAmount(BigInt(x.amount), x.tokenMeta.decimals);

const INVOICE_STATUS = ["open", "paying", "paid", "returned", "expired"];
const PAYMENT_STATUS = ["pending", "settled", "refunded", "failed"];
const LIST_LIMIT = 50; // ponytail: newest 50 per list keeps the model context small; add paging if merchants ask for more.

const invoiceStatus = (inv: any, nowSec: number) =>
  inv.status === "Open" && inv.expires_at_sec <= nowSec ? "expired" : String(inv.status).toLowerCase();
const paymentStatus = (p: any) => (p.status === "SettleFailed" || p.status === "RefundFailed" ? "failed" : String(p.status).toLowerCase());

const invoiceView = (inv: any, nowSec: number) => ({
  id: inv.id,
  amount: decimal(inv),
  symbol: inv.tokenMeta.symbol,
  memo: inv.memo ?? null,
  status: invoiceStatus(inv, nowSec),
  expires_at: iso(inv.expires_at_sec),
  payment: inv.payment ?? null,
});

const paymentView = (p: any) => ({
  id: p.id,
  invoice: p.invoice,
  amount: decimal(p),
  symbol: p.tokenMeta.symbol,
  status: paymentStatus(p),
  payer: p.reference ? p.refund_to : p.payer,
  opened_at: iso(p.opened_at_sec),
});

const obj = (properties: object = {}, required: string[] = []) => ({ type: "object", properties, required });
const idArg = obj({ id: { type: "integer", minimum: 0 } }, ["id"]);
const validId = (id: unknown): id is number => Number.isSafeInteger(id) && (id as number) >= 0;
const NOT_FOUND = { error: "not found" };

async function allOf(deps: Deps, kind: "invoices" | "payments", m: GatewayMerchant) {
  const g = await readGateway(deps, m.gateway_id);
  return withMeta(deps, await newestFirst(deps, `get_${kind}`, m.gateway_id, g[kind]));
}

/// One item of the merchant's gateway with token metadata, or undefined when missing or foreign.
async function oneOf(deps: Deps, kind: "invoice" | "payment", id: unknown, m: GatewayMerchant) {
  if (!validId(id)) return undefined;
  const x = await deps.near.view(deps.cfg.gateflow, `get_${kind}`, { [kind]: id });
  if (!x || x.gateway !== m.gateway_id) return undefined;
  return { id, ...x, tokenMeta: await tokenMeta(deps, x.token) };
}

/// Period start in seconds: UTC midnight for "today", else 7 or 30 days back.
const periodStart = (period: string, nowSec: number) =>
  period === "today" ? Math.floor(nowSec / 86400) * 86400 : period === "7d" ? nowSec - 7 * 86400 : period === "30d" ? nowSec - 30 * 86400 : undefined;

export function readTools(deps: Deps): Record<string, Tool> {
  const nowSec = () => Math.floor(deps.now() / 1000);
  return {
    list_invoices: {
      name: "list_invoices",
      description: `The merchant's invoices, newest first (at most ${LIST_LIMIT}). "expired" means open past its expiry.`,
      parameters: obj({ status: { type: "string", enum: INVOICE_STATUS } }),
      group: "invoices",
      async run(args, m) {
        const status = args?.status;
        if (status !== undefined && !INVOICE_STATUS.includes(status)) return { error: `status must be one of ${INVOICE_STATUS.join(", ")}` };
        const now = nowSec();
        return (await allOf(deps, "invoices", m))
          .map((i) => invoiceView(i, now))
          .filter((i) => !status || i.status === status)
          .slice(0, LIST_LIMIT);
      },
    },
    get_invoice: {
      name: "get_invoice",
      description: "One invoice of the merchant by id.",
      parameters: idArg,
      group: "invoices",
      async run(args, m) {
        const inv = await oneOf(deps, "invoice", args?.id, m);
        return inv ? invoiceView(inv, nowSec()) : NOT_FOUND;
      },
    },
    list_payments: {
      name: "list_payments",
      description: `The merchant's payments, newest first (at most ${LIST_LIMIT}). "failed" means the release or return failed and can be retried.`,
      parameters: obj({ status: { type: "string", enum: PAYMENT_STATUS } }),
      group: "payments",
      async run(args, m) {
        const status = args?.status;
        if (status !== undefined && !PAYMENT_STATUS.includes(status)) return { error: `status must be one of ${PAYMENT_STATUS.join(", ")}` };
        return (await allOf(deps, "payments", m))
          .map(paymentView)
          .filter((p) => !status || p.status === status)
          .slice(0, LIST_LIMIT);
      },
    },
    get_payment: {
      name: "get_payment",
      description: "One payment of the merchant by id.",
      parameters: idArg,
      group: "payments",
      async run(args, m) {
        const p = await oneOf(deps, "payment", args?.id, m);
        return p ? paymentView(p) : NOT_FOUND;
      },
    },
    settled_totals: {
      name: "settled_totals",
      description: "Settled amounts per token for today (UTC), the last 7 days or the last 30 days, by the time the payment arrived.",
      parameters: obj({ period: { type: "string", enum: ["today", "7d", "30d"] } }, ["period"]),
      group: "totals",
      async run(args, m) {
        const since = periodStart(String(args?.period), nowSec());
        if (since === undefined) return { error: "period must be today, 7d or 30d" };
        // The contract stores no settle time, so the open time stands in for it (design decision 9).
        const sums = new Map<string, { meta: TokenMeta; raw: bigint }>();
        for (const p of await allOf(deps, "payments", m)) {
          if (p.status !== "Settled" || p.opened_at_sec < since) continue;
          const s = sums.get(p.token) ?? { meta: p.tokenMeta, raw: 0n };
          s.raw += BigInt(p.amount);
          sums.set(p.token, s);
        }
        return [...sums.values()].map((s) => ({ symbol: s.meta.symbol, amount: formatAmount(s.raw, s.meta.decimals) }));
      },
    },
    accepted_tokens: {
      name: "accepted_tokens",
      description: "The tokens on the operator's allowlist, with whether the merchant accepts each.",
      parameters: obj(),
      group: "tokens",
      async run(_args, m) {
        const list: string[] = await deps.near.view(deps.cfg.gateflow, "get_tokens", {});
        return Promise.all(list.map(async (token) => ({ token, ...(await tokenMeta(deps, token)), enabled: !m.tokens_off.includes(token) })));
      },
    },
    gateway_settings: {
      name: "gateway_settings",
      description: "The gateway's payout account, risk tolerance (max_risk, 0 to 80) and whether its fuel is ready.",
      parameters: obj(),
      group: "settings",
      async run(_args, m) {
        const g = await readGateway(deps, m.gateway_id);
        return { payout_to: g.payout_to, max_risk: g.policy.max_risk, fuel: g.fuelReady ? "ready" : "topping up" };
      },
    },
  };
}

const MAX_RISK = 80;
const MAX_HOURS = 720;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/// Write tools only propose: each validates, stores a pending `chat_actions` row in contract form, and returns its id.
export function writeTools(deps: Deps): Record<string, Tool> {
  return {
    create_invoice: {
      name: "create_invoice",
      description: "Propose an invoice. Nothing is created until the merchant confirms the card with their passkey.",
      parameters: obj(
        {
          token: { type: "string", description: "Token symbol or account id from the accepted tokens" },
          amount: { type: "string", description: "Decimal amount, e.g. \"0.01\"" },
          expires_in: { type: "integer", minimum: 1, maximum: MAX_HOURS, description: "Hours until expiry, default 1" },
          memo: { type: "string", description: "Optional note shown to the payer, at most 140 bytes" },
        },
        ["token", "amount"],
      ),
      group: "invoices",
      async run(args, m, threadId) {
        const list: string[] = await deps.near.view(deps.cfg.gateflow, "get_tokens", {});
        const wanted = String(args?.token ?? "").trim().toLowerCase();
        let token: { id: string; meta: TokenMeta } | undefined;
        for (const id of list) {
          const meta = await tokenMeta(deps, id);
          if (id === wanted || meta.symbol.toLowerCase() === wanted) token = { id, meta };
        }
        if (!token) return { error: `token ${args?.token} is not accepted; call accepted_tokens` };
        if (m.tokens_off.includes(token.id)) return { error: `${token.meta.symbol} is switched off in Settings` };
        let raw: bigint;
        try {
          raw = parseAmount(String(args?.amount ?? ""), token.meta.decimals);
        } catch (e) {
          return { error: (e as Error).message };
        }
        const hours = args?.expires_in ?? 1;
        if (!Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS) return { error: `expires_in must be whole hours from 1 to ${MAX_HOURS}` };
        const memo = typeof args?.memo === "string" ? args.memo.trim() : "";
        if (new TextEncoder().encode(memo).length > 140) return { error: "memo must be at most 140 bytes" };
        const params = { gateway: m.gateway_id, token: token.id, amount: raw.toString(), expires_in_sec: hours * 3600, ...(memo ? { memo } : {}) };
        const actionId = deps.db.addAction({ thread_id: threadId, email: m.email, kind: "create_invoice", params });
        const summary = `Create invoice ${formatAmount(raw, token.meta.decimals)} ${token.meta.symbol}, expires in ${plural(hours, "hour")}${memo ? `, memo "${memo}"` : ""}`;
        return { actionId, summary };
      },
    },
    set_risk_tolerance: {
      name: "set_risk_tolerance",
      description: "Propose a new risk tolerance (max_risk, 0 strictest to 80). Nothing changes until the merchant confirms with their passkey.",
      parameters: obj({ max_risk: { type: "integer", minimum: 0, maximum: MAX_RISK } }, ["max_risk"]),
      group: "settings",
      async run(args, m, threadId) {
        const risk = args?.max_risk;
        if (!Number.isInteger(risk) || risk < 0 || risk > MAX_RISK) return { error: `max_risk must be a whole number from 0 to ${MAX_RISK}` };
        const g = await readGateway(deps, m.gateway_id);
        const actionId = deps.db.addAction({ thread_id: threadId, email: m.email, kind: "set_policy", params: { gateway: m.gateway_id, policy: { max_risk: risk } } });
        return { actionId, summary: `Set risk tolerance to ${risk} (now ${g.policy.max_risk})` };
      },
    },
    retry_payment: {
      name: "retry_payment",
      description: "Propose retrying a failed payment's release or return. Nothing happens until the merchant confirms.",
      parameters: idArg,
      group: "payments",
      async run(args, m, threadId) {
        const p = await oneOf(deps, "payment", args?.id, m);
        if (!p) return NOT_FOUND;
        if (paymentStatus(p) !== "failed") return { error: "only failed payments can be retried" };
        const actionId = deps.db.addAction({ thread_id: threadId, email: m.email, kind: "retry", params: { payment: p.id } });
        return { actionId, summary: `Retry payment #${p.id} of ${decimal(p)} ${p.tokenMeta.symbol}` };
      },
    },
  };
}
