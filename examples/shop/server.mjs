// A demo coffee shop that takes Gateflow payments. Node built-ins only, state in memory.
// Usage: GATEFLOW_URL=https://<relay> GATEFLOW_KEY=gf_test_... GATEFLOW_WEBHOOK_SECRET=whsec_... [PORT=8080] node server.mjs
// Expose it with an HTTPS tunnel (a fixed tunnel name keeps the console settings valid between runs), then in
// Settings > Developers add the tunnel origin to Allowed origins and set the webhook URL to <tunnel>/webhook.
// Tests: node --test examples/shop/server.test.mjs
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const GATEFLOW = (process.env.GATEFLOW_URL ?? "http://localhost:8787").replace(/\/$/, "");
const KEY = process.env.GATEFLOW_KEY;
const SECRET = process.env.GATEFLOW_WEBHOOK_SECRET;
const PORT = Number(process.env.PORT ?? 8080);
const CURRENCY = "USDC";
const MAX_SKEW_SEC = 300;
const MAX_QTY = 10;

/// Prices in micro-USDC, at most 0.01 each, so a live demo costs cents.
export const CATALOG = [
  { id: "espresso", name: "Espresso shot", emoji: "☕", price: 10_000 },
  { id: "cortado", name: "Cortado", emoji: "🥛", price: 10_000 },
  { id: "beans", name: "Beans sample, 20 g", emoji: "🫘", price: 5_000 },
  { id: "sticker", name: "Shop sticker", emoji: "🏷️", price: 2_000 },
];

/// 15000 -> "0.015", 10000 -> "0.01". Integer math, no float drift.
const fmt = (micro) => `${Math.floor(micro / 1e6)}.${String(micro % 1e6).padStart(6, "0").replace(/0+$/, "").padEnd(2, "0")}`;

/// Lines and total of a cart `[{id, qty}]`, priced from CATALOG. Throws on anything the page should not send.
export function priceCart(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("cart is empty");
  const seen = new Set();
  let total = 0;
  const lines = items.map(({ id, qty } = {}) => {
    const p = CATALOG.find((c) => c.id === id);
    if (!p) throw new Error(`unknown product ${id}`);
    if (seen.has(id)) throw new Error(`${id} listed twice`);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new Error(`quantity of ${id} must be 1 to ${MAX_QTY}`);
    seen.add(id);
    total += p.price * qty;
    return { id, name: p.name, emoji: p.emoji, qty, price: fmt(p.price) };
  });
  return { lines, total: fmt(total) };
}

const RANK = { pending: 0, paying: 1, paid: 2, expired: 2, returned: 2 };

/// The order's next status for a webhook event, or null when the event would not move it forward (repeats, late events).
export function applyEvent(order, event) {
  const next = String(event).replace(/^invoice\./, "");
  return next in RANK && RANK[next] > RANK[order.status] ? next : null;
}

/// True when `header` (`t=<s>,v1=<hex>`) signs `body` with `secret` within five minutes of now.
export function verifySignature(header, body, secret, nowSec = Math.floor(Date.now() / 1000)) {
  const parts = Object.fromEntries(String(header ?? "").split(",").map((p) => p.split("=", 2)));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(nowSec - t) > MAX_SKEW_SEC || !/^[0-9a-f]{64}$/.test(parts.v1 ?? "")) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  return timingSafeEqual(expected, Buffer.from(parts.v1, "hex"));
}

export const orders = new Map();
/// Last 50 webhooks received, newest first, for the merchant strip.
export const webhookLog = [];

/// Fulfil here, never from the page's onStatus events. Bad signatures are logged too, so a wrong secret shows on screen.
export function handleWebhook(header, body, secret = SECRET) {
  const sigOk = verifySignature(header, body, secret);
  let e = {};
  try {
    e = JSON.parse(body);
  } catch {}
  webhookLog.unshift({ at: new Date().toISOString(), event: String(e.event ?? "?"), order_id: String(e.data?.order_id ?? "?"), status: String(e.data?.status ?? "?"), sig_ok: sigOk });
  webhookLog.length = Math.min(webhookLog.length, 50);
  if (!sigOk) return { status: 400, body: { error: "bad signature" } };
  const order = orders.get(e.data?.order_id);
  const next = order && applyEvent(order, e.event);
  if (next) Object.assign(order, { status: next, updated_at: new Date().toISOString() });
  console.log("webhook", e.event, e.data?.order_id, next ? `-> ${next}` : "(no change)");
  return { status: 200, body: { ok: true } };
}

const readBody = async (req) => {
  let s = "";
  for await (const c of req) s += c;
  return s;
};

const send = (res, status, body, type = "application/json") => res.writeHead(status, { "content-type": type }).end(typeof body === "string" ? body : JSON.stringify(body));

if (import.meta.main) {
  if (!KEY || !SECRET) throw new Error("set GATEFLOW_KEY and GATEFLOW_WEBHOOK_SECRET");
  const page = readFileSync(new URL("./index.html", import.meta.url), "utf8").replaceAll("GATEFLOW_URL", GATEFLOW);
  // Run prefix keeps order ids unique across restarts, so the API's order_id dedup never hands back an old invoice.
  const run = Date.now().toString(36);
  let n = 0;

  createServer(async (req, res) => {
    const path = new URL(req.url, "http://shop").pathname;
    const orderId = path.match(/^\/orders?\/([\w-]+)$/)?.[1];

    if (req.method === "GET" && (path === "/" || (orderId && path.startsWith("/order/")))) return send(res, 200, page, "text/html; charset=utf-8");
    if (req.method === "GET" && path === "/catalog") return send(res, 200, { currency: CURRENCY, items: CATALOG.map((p) => ({ ...p, price: fmt(p.price) })) });
    if (req.method === "GET" && orderId) return orders.has(orderId) ? send(res, 200, orders.get(orderId)) : send(res, 404, { error: "no such order" });
    if (req.method === "GET" && path === "/events") return send(res, 200, webhookLog);

    // Your checkout: price the cart on the server, then create one invoice per order where the API key lives.
    if (req.method === "POST" && path === "/checkout") {
      let priced;
      try {
        priced = priceCart(JSON.parse(await readBody(req)).items);
      } catch (err) {
        return send(res, 400, { error: err instanceof SyntaxError ? "bad JSON" : err.message });
      }
      const id = `ord_${run}_${++n}`;
      let r;
      try {
        r = await fetch(`${GATEFLOW}/api/v1/invoices`, {
          method: "POST",
          headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
          body: JSON.stringify({ amount: priced.total, currency: CURRENCY, order_id: id }),
        });
      } catch (err) {
        console.log("checkout", id, "Gateflow unreachable:", err.cause?.code ?? err.message);
        return send(res, 502, { error: "Gateflow is unreachable" });
      }
      const invoice = await r.json().catch(() => ({ error: `Gateflow answered ${r.status}` }));
      console.log("checkout", id, priced.total, CURRENCY, r.status, invoice.id ?? invoice.error);
      if (!r.ok) return send(res, r.status, invoice);
      const order = { id, ...priced, currency: CURRENCY, status: "pending", invoice: { id: invoice.id, url: invoice.url }, created_at: new Date().toISOString() };
      orders.set(id, order);
      return send(res, 201, { order, invoice });
    }

    if (req.method === "POST" && path === "/webhook") {
      const r = handleWebhook(req.headers["gateflow-signature"], await readBody(req));
      return send(res, r.status, r.body);
    }
    send(res, 404, { error: "not found" });
  }).listen(PORT, () => {
    console.log(`shop on http://localhost:${PORT}, Gateflow at ${GATEFLOW}`);
    console.log("Settings > Developers: Allowed origin = your tunnel origin (https://<tunnel>), webhook URL = https://<tunnel>/webhook");
  });
}
