// The console assistant: model client, tools and the bounded tool loop (design decisions 2 to 9).
import { finishAction, newestFirst, submitClaimed, readGateway, requireAction, requireGateway, requireSession, retryablePayment, sendRetry, tokenMeta, type TokenMeta, withMeta } from "./console.ts";
import type { Card, Merchant, Message } from "./db.ts";
import { type ChatMessage, type Completion, type Config, type Deps, type Handler, HttpError, type Llm, ok, type ToolDef } from "./types.ts";

const LLM_TIMEOUT_MS = 60_000;

/// OpenAI-compatible `/chat/completions` client over plain fetch. Tool schemas carry no `strict` flag.
export function llmClient(cfg: Pick<Config, "llmBaseUrl" | "llmApiKey" | "llmModel">): Llm {
  return {
    async complete(messages, tools) {
      const res = await fetch(`${cfg.llmBaseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.llmApiKey}` },
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
        body: JSON.stringify({ model: cfg.llmModel, messages, ...(tools.length ? { tools: tools.map((t) => ({ type: "function", function: t })) } : {}) }),
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
        const summary = `Create invoice ${formatAmount(raw, token.meta.decimals)} ${token.meta.symbol}, expires in ${plural(hours, "hour")}${memo ? `, memo "${memo}"` : ""}`;
        return { actionId: deps.db.addAction({ thread_id: threadId, email: m.email, kind: "create_invoice", params, summary }), summary };
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
        const summary = `Set risk tolerance to ${risk} (now ${g.policy.max_risk})`;
        return { actionId: deps.db.addAction({ thread_id: threadId, email: m.email, kind: "set_policy", params: { gateway: m.gateway_id, policy: { max_risk: risk } }, summary }), summary };
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
        const summary = `Retry payment #${p.id} of ${decimal(p)} ${p.tokenMeta.symbol}`;
        return { actionId: deps.db.addAction({ thread_id: threadId, email: m.email, kind: "retry", params: { payment: p.id }, summary }), summary };
      },
    },
  };
}

// ---------- the loop ----------

export const MAX_ROUNDS = 6;
export const HISTORY = 30;
export const UNAVAILABLE = "The assistant is unavailable right now";

export type AssistantTurn = { text: string; trace: string[]; cards: Card[] };
export type Ports = { llm: Llm; tools: Record<string, Tool>; threadId: number; system: string };

/// Cards a tool result earns: a confirm card for a proposal, a status card for a single invoice.
function cardsFor(name: string, result: any): Card[] {
  if (typeof result?.actionId === "number") return [{ type: "confirm", actionId: result.actionId }];
  if (name === "get_invoice" && typeof result?.id === "number") return [{ type: "status", invoiceId: result.id }];
  return [];
}

/// Runs at most MAX_ROUNDS tool rounds, then asks once more without tools. Model errors end the turn with UNAVAILABLE.
export async function runAssistant(ports: Ports, m: GatewayMerchant, history: { role: "user" | "assistant"; text: string }[], message: string): Promise<AssistantTurn> {
  const msgs: ChatMessage[] = [{ role: "system", content: ports.system }, ...history.map((h) => ({ role: h.role, content: h.text })), { role: "user", content: message }];
  const defs = Object.values(ports.tools).map(({ name, description, parameters }) => ({ name, description, parameters }));
  const trace: string[] = [];
  const cards: Card[] = [];
  try {
    for (let round = 0; ; round++) {
      const reply = await ports.llm.complete(msgs, round < MAX_ROUNDS ? defs : []);
      if (!reply.toolCalls?.length || round >= MAX_ROUNDS) return { text: reply.content?.trim() || "I have no answer to that.", trace, cards };
      msgs.push({
        role: "assistant",
        content: reply.content ?? null,
        tool_calls: reply.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
      });
      for (const call of reply.toolCalls) {
        const tool = ports.tools[call.name];
        let result: unknown;
        if (!tool) result = { error: `unknown tool ${call.name}` };
        else {
          let args: unknown;
          try {
            args = call.arguments.trim() ? JSON.parse(call.arguments) : {};
          } catch {
            args = undefined;
          }
          if (args === undefined || typeof args !== "object" || args === null) result = { error: "arguments are not valid JSON" };
          else {
            result = await tool.run(args, m, ports.threadId);
            if (!trace.includes(tool.group)) trace.push(tool.group);
            cards.push(...cardsFor(call.name, result));
          }
        }
        msgs.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) });
      }
    }
  } catch (e) {
    console.error("assistant turn failed:", (e as Error).message);
    return { text: UNAVAILABLE, trace, cards };
  }
}

/// The fixed system prompt (design decision 6).
export function systemPrompt(tokens: { symbol: string; decimals: number; token: string }[], now: Date): string {
  return [
    "You are the assistant in the Gateflow merchant console.",
    "Gateflow takes crypto payments for the merchant's invoices. A payer's funds are held in the Gateflow contract while an enclave screens the payer; the payment is then released to the merchant or returned to the payer automatically. The merchant makes no decisions on individual payments.",
    `The merchant accepts these tokens: ${tokens.map((t) => `${t.symbol} (${t.decimals} decimals, ${t.token})`).join(", ") || "none"}. "BTC" means nBTC, "NEAR" means wNEAR and "dollars" mean USDC when those are accepted.`,
    `Today is ${now.toISOString().slice(0, 10)} (UTC).`,
    "Rules:",
    "- Use the tools for every fact about invoices, payments, totals, tokens and settings. Never guess.",
    "- create_invoice, set_risk_tolerance and retry_payment only propose. The merchant sees a card and must confirm it with their passkey. Never say an action is done; say it is ready to confirm.",
    "- Give amounts as decimal strings with the token symbol, for example 0.01 nBTC.",
    "- If the merchant asks for a token they do not accept, say so and list the accepted tokens. Never offer the same amount in another token: tokens have different values.",
    "- Answer briefly in plain payment language, without gas, nonces or transaction hashes.",
    "- Refuse requests that are not about this Gateflow console.",
  ].join("\n");
}

// ---------- routes ----------

const MAX_MESSAGE = 4000;
const TITLE = 60;

export function assistantTools(deps: Deps): Record<string, Tool> {
  return { ...readTools(deps), ...writeTools(deps) };
}

const publicMessage = (x: Message & { id: number }) => ({ id: x.id, role: x.role, text: x.text, trace: x.trace, cards: x.cards, created_at: x.created_at });

const chat: Handler = async (req, deps) => {
  const m = requireGateway(req, deps);
  if (!deps.llm) throw new HttpError(503, "assistant not configured");
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE) throw new HttpError(400, `message must be 1 to ${MAX_MESSAGE} characters`);
  let threadId = req.body?.threadId;
  if (threadId !== undefined && threadId !== null && !(validId(threadId) && deps.db.thread(threadId, m.email))) throw new HttpError(404, "thread not found");

  const nowSec = Math.floor(deps.now() / 1000);
  if (deps.db.userMessagesSince(m.email, Math.floor(nowSec / 86400) * 86400) >= deps.cfg.chatDailyLimit) {
    throw new HttpError(429, "daily assistant limit reached, try again tomorrow");
  }
  const history = threadId == null ? [] : deps.db.messages(threadId, HISTORY - 1);
  if (threadId == null) threadId = deps.db.createThread(m.email, message.slice(0, TITLE).trim(), nowSec);

  const user: Message = { thread_id: threadId, role: "user", text: message, trace: [], cards: [], created_at: nowSec };
  const userId = deps.db.addMessage(user);
  const list: string[] = await deps.near.view(deps.cfg.gateflow, "get_tokens", {});
  const enabled = await Promise.all(list.filter((t) => !m.tokens_off.includes(t)).map(async (token) => ({ token, ...(await tokenMeta(deps, token)) })));
  const turn = await runAssistant({ llm: deps.llm, tools: assistantTools(deps), threadId, system: systemPrompt(enabled, new Date(deps.now())) }, m, history, message);
  const reply: Message = { thread_id: threadId, role: "assistant", ...turn, created_at: Math.floor(deps.now() / 1000) };
  const replyId = deps.db.addMessage(reply);
  return ok({ threadId, messages: [publicMessage({ ...user, id: userId }), publicMessage({ ...reply, id: replyId })] });
};

const threads: Handler = async (req, deps) => {
  const email = requireSession(req, deps);
  return ok(deps.db.threadsOf(email, 50).map((t) => ({ id: t.id, title: t.title, created_at: t.created_at })));
};

const thread: Handler = async (req, deps) => {
  const email = requireSession(req, deps);
  const id = Number(req.query.get("id"));
  const t = validId(id) ? deps.db.thread(id, email) : undefined;
  if (!t) throw new HttpError(404, "thread not found");
  return ok({ id: t.id, title: t.title, created_at: t.created_at, messages: deps.db.messages(t.id, 1000).map((x) => publicMessage(x as Message & { id: number })) });
};

// ---------- actions ----------

const action: Handler = async (req, deps) => {
  const a = requireAction(deps, Number(req.query.get("id")), requireSession(req, deps));
  return ok({ id: a.id, kind: a.kind, params: a.params, summary: a.summary, status: a.status, result: a.result });
};

/// Executes a confirmed `retry` through the operator. Passkey actions confirm through POST /console/relay instead.
const confirm: Handler = async (req, deps) => {
  const m = requireGateway(req, deps);
  const a = requireAction(deps, req.body?.id, m.email);
  if (a.kind !== "retry") throw new HttpError(400, "this action needs your passkey");
  if (a.status !== "pending") throw new HttpError(409, `action is ${a.status}`);
  const p = await retryablePayment(deps, m.gateway_id, a.params.payment);
  if (!deps.db.claimAction(a.id)) throw new HttpError(409, "action already confirmed");
  const r = await submitClaimed(deps, a, () => sendRetry(deps, a.params.payment));
  if (r.error) {
    finishAction(deps.db, a, "failed", { error: r.error }, deps.now());
    throw new HttpError(422, r.error);
  }
  finishAction(deps.db, a, "done", { txHash: r.hash }, deps.now(), {
    text: `Retry of payment #${a.params.payment} requested`,
    cards: [{ type: "status", invoiceId: p.invoice }],
  });
  return ok({ txHash: r.hash });
};

const dismiss: Handler = async (req, deps) => {
  const a = requireAction(deps, req.body?.id, requireSession(req, deps));
  if (!deps.db.dismissAction(a.id)) throw new HttpError(409, `action is ${a.status}`);
  return ok({ status: "dismissed" });
};

export const chatRoutes: Record<string, Handler> = {
  "POST /console/chat": chat,
  "GET /console/threads": threads,
  "GET /console/thread": thread,
  "GET /console/action": action,
  "POST /console/actions/confirm": confirm,
  "POST /console/actions/dismiss": dismiss,
};
