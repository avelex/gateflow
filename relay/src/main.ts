// The Gateflow backend: one node:http server for the console API, the checkout API and the web app.
import { createServer, type IncomingMessage } from "node:http";
import { chatRoutes, llmClient } from "./chat.ts";
import { checkoutRoutes } from "./checkout.ts";
import { consoleRoutes, syncRegistrations } from "./console.ts";
import { openDb } from "./db.ts";
import { rpcNear } from "./near.ts";
import { originRequest, parseSenders } from "./origin.ts";
import { serveStatic } from "./static.ts";
import { startWatcher } from "./watcher.ts";
import { type Deps, type Handler, HttpError, loadConfig, type OneClick, type OriginApi, type OutLayerApi, type Req, type Res } from "./types.ts";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST, OPTIONS" };
const MAX_BODY = 64 * 1024;

export const routes: Record<string, Handler> = { ...consoleRoutes, ...chatRoutes, ...checkoutRoutes };

export async function dispatch(table: Record<string, Handler>, req: Req, deps: Deps): Promise<Res> {
  const checkout = /^\/checkout(\/|$)/.test(req.path);
  let res: Res;
  if (checkout && req.method === "OPTIONS") res = { status: 204 };
  else {
    const handler = table[`${req.method} ${req.path}`];
    try {
      if (handler) res = await handler(req, deps);
      else {
        const file = req.method === "GET" ? serveStatic(deps.cfg.webDist, req.path) : undefined;
        if (!file) throw new HttpError(404, "not found");
        res = file;
      }
    } catch (e) {
      if (e instanceof HttpError) res = { status: e.status, json: { error: e.message } };
      else {
        console.error(`${req.method} ${req.path}:`, e);
        res = { status: 502, json: { error: `upstream failure: ${(e as Error).message}` } };
      }
    }
  }
  return checkout ? { ...res, headers: { ...res.headers, ...CORS } } : res;
}

function cookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "body too large");
    chunks.push(chunk);
  }
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "body is not JSON");
  }
}

export function outlayerApi(baseUrl: string): OutLayerApi {
  return {
    async jobs(q) {
      const params = new URLSearchParams({ user_account_id: q.user, project: q.project, limit: String(q.limit), offset: String(q.offset) });
      const res = await fetch(`${baseUrl}/public/jobs?${params}`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`OutLayer ${res.status}`);
      const body = await res.json();
      if (!Array.isArray(body)) throw new Error("OutLayer jobs: not a list");
      return body;
    },
  };
}

export function originApi(): OriginApi {
  return {
    async senders(chain, hash) {
      const r = originRequest(chain, hash);
      if (!r) return undefined;
      const res = await fetch(r.url, { ...r.init, signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`origin ${chain} ${res.status}`);
      return parseSenders(chain, hash, await res.json());
    },
  };
}

export function oneClick(baseUrl: string, apiKey?: string): OneClick {
  const call = async (path: string, init?: RequestInit) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (apiKey) headers["x-api-key"] = apiKey;
    const res = await fetch(`${baseUrl}/v0${path}`, { ...init, headers });
    const body: any = await res.json().catch(() => undefined);
    if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, `1Click ${res.status}: ${body?.message ?? "error"}`);
    return body;
  };
  return {
    tokens: () => call("/tokens"),
    quote: (body) => call("/quote", { method: "POST", body: JSON.stringify(body) }),
    status: (addr) => call(`/status?depositAddress=${encodeURIComponent(addr)}`),
  };
}

export function serve(deps: Deps, table = routes) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let out: Res;
    try {
      const body = req.method === "GET" || req.method === "OPTIONS" ? undefined : await readBody(req);
      out = await dispatch(table, { method: req.method ?? "GET", path: url.pathname, query: url.searchParams, body, cookies: cookies(req.headers.cookie) }, deps);
    } catch (e) {
      out = e instanceof HttpError ? { status: e.status, json: { error: e.message } } : { status: 500, json: { error: "internal error" } };
      if (/^\/checkout(\/|$)/.test(url.pathname)) out.headers = CORS;
    }
    const headers: Record<string, string> = { ...out.headers };
    let payload = out.body;
    if (out.json !== undefined) {
      payload = JSON.stringify(out.json, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
      headers["content-type"] = "application/json";
    }
    res.writeHead(out.status, headers).end(payload);
  });
}

if (import.meta.main) {
  const cfg = loadConfig(process.env);
  const deps: Deps = {
    cfg,
    db: openDb(cfg.dbPath),
    near: rpcNear({ rpcUrl: cfg.rpcUrl, accountId: cfg.accountId, secret: cfg.secret }),
    // A second client for the same account would race the first on its nonce.
    creator: cfg.merchantParent === cfg.accountId ? undefined : rpcNear({ rpcUrl: cfg.rpcUrl, accountId: cfg.merchantParent, secret: cfg.secret }),
    oneclick: oneClick(cfg.oneclickUrl, cfg.oneclickKey),
    outlayer: outlayerApi(cfg.outlayerApi),
    origin: originApi(),
    llm: cfg.llmApiKey ? llmClient(cfg) : undefined,
    now: Date.now,
  };
  serve(deps).listen(cfg.port, () => console.log(`gateflow relay on :${cfg.port} (contract ${cfg.gateflow})`));
  startWatcher(deps);
  syncRegistrations(deps).then((n) => console.log(`payout registrations sent: ${n}`), console.error);
}
