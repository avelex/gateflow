// A minimal shop that takes Gateflow payments. Node built-ins only.
// Usage: GATEFLOW_URL=https://<relay> GATEFLOW_KEY=gf_test_... GATEFLOW_WEBHOOK_SECRET=whsec_... [AMOUNT=1.00 CURRENCY=USDC] node server.mjs
// Then open http://localhost:8080 (add it to Settings > Developers > Allowed origins).
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const GATEFLOW = (process.env.GATEFLOW_URL ?? "http://localhost:8787").replace(/\/$/, "");
const KEY = process.env.GATEFLOW_KEY;
const SECRET = process.env.GATEFLOW_WEBHOOK_SECRET;
const PORT = Number(process.env.PORT ?? 8080);
const AMOUNT = process.env.AMOUNT ?? "1.00";
const CURRENCY = process.env.CURRENCY ?? "USDC";
const MAX_SKEW_SEC = 300;

/// True when `header` (`t=<s>,v1=<hex>`) signs `body` with `secret` within five minutes of now.
export function verifySignature(header, body, secret, nowSec = Math.floor(Date.now() / 1000)) {
  const parts = Object.fromEntries(String(header ?? "").split(",").map((p) => p.split("=", 2)));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(nowSec - t) > MAX_SKEW_SEC || !/^[0-9a-f]{64}$/.test(parts.v1 ?? "")) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  return timingSafeEqual(expected, Buffer.from(parts.v1, "hex"));
}

const readBody = async (req) => {
  let s = "";
  for await (const c of req) s += c;
  return s;
};

const send = (res, status, body, type = "application/json") => res.writeHead(status, { "content-type": type }).end(typeof body === "string" ? body : JSON.stringify(body));

if (import.meta.main) {
  if (!KEY || !SECRET) throw new Error("set GATEFLOW_KEY and GATEFLOW_WEBHOOK_SECRET");
  const page = readFileSync(new URL("./index.html", import.meta.url), "utf8")
    .replaceAll("GATEFLOW_URL", GATEFLOW)
    .replaceAll("PRICE", `${AMOUNT} ${CURRENCY}`);
  createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/") return send(res, 200, page, "text/html; charset=utf-8");

    // Your checkout: create one invoice per order on the server, where the API key lives.
    if (req.method === "POST" && req.url === "/checkout") {
      const orderId = `order_${Date.now()}`;
      const r = await fetch(`${GATEFLOW}/api/v1/invoices`, {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ amount: AMOUNT, currency: CURRENCY, order_id: orderId }),
      });
      const invoice = await r.json();
      console.log("created", r.status, invoice);
      return send(res, r.status, invoice);
    }

    // Fulfil orders here, never from the page's onStatus events.
    if (req.method === "POST" && req.url === "/webhook") {
      const body = await readBody(req);
      if (!verifySignature(req.headers["gateflow-signature"], body, SECRET)) return send(res, 400, { error: "bad signature" });
      const e = JSON.parse(body);
      console.log("webhook", e.event, e.data.order_id, e.data.status);
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: "not found" });
  }).listen(PORT, () => console.log(`shop on http://localhost:${PORT}, Gateflow at ${GATEFLOW}`));
}
