// Webhooks: Stripe-style signed POSTs of API invoice events, retried with backoff, never to private addresses.
import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { type ApiStatus, type ChainInvoice, invoiceObject } from "./api.ts";
import { tokenMeta } from "./console.ts";
import type { Deps } from "./types.ts";

export const RETRY_DELAYS_SEC = [60, 300, 1800, 7200, 43200];
export const DELIVERY_TIMEOUT_MS = 10_000;

/// `Gateflow-Signature` value for `body` sent at unix second `t`.
export const signature = (secret: string, t: number, body: string) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

/// When to try again after `attempts` failed tries, or undefined once the retries are used up.
export function retryAt(attempts: number, nowMs: number): number | undefined {
  const delay = RETRY_DELAYS_SEC[attempts - 1];
  return delay === undefined ? undefined : nowMs + delay * 1000;
}

const PRIVATE = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16]] as const)
  PRIVATE.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10]] as const) PRIVATE.addSubnet(net, bits, "ipv6");

/// Loopback, private, link-local, CGNAT or unspecified, including IPv4-mapped IPv6 forms.
export function isPrivateAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (mapped) return PRIVATE.check(mapped, "ipv4");
  const v = isIP(ip);
  return v === 0 || PRIVATE.check(ip, v === 4 ? "ipv4" : "ipv6");
}

export type WebhookIo = {
  fetch: (url: string, init: RequestInit) => Promise<{ status: number }>;
  lookup: (host: string) => Promise<{ address: string }>;
};

const realIo: WebhookIo = { fetch: (url, init) => fetch(url, init), lookup: (host) => lookup(host) };

/// Sends every due delivery once and schedules its retry or closes it.
export async function deliver(deps: Deps, io: WebhookIo = realIo): Promise<void> {
  for (const d of deps.db.dueDeliveries(deps.now())) {
    const { webhook_url, webhook_secret } = deps.db.gatewayDev(d.gateway);
    let ok = false;
    try {
      if (!webhook_url || !webhook_secret) throw new Error("no webhook URL");
      const url = new URL(webhook_url);
      // ponytail: resolve-then-fetch leaves a DNS-rebinding window; pin the resolved address with a custom agent if that matters.
      const host = url.hostname.replace(/^\[|\]$/g, "");
      const address = isIP(host) ? host : (await io.lookup(host)).address;
      if (isPrivateAddress(address)) throw new Error(`refusing private address ${address}`);
      const t = Math.floor(deps.now() / 1000);
      const res = await io.fetch(url.toString(), {
        method: "POST",
        headers: { "content-type": "application/json", "gateflow-signature": signature(webhook_secret, t, d.body) },
        body: d.body,
        redirect: "manual",
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
      ok = res.status >= 200 && res.status < 300;
      if (!ok) console.error(`webhook ${d.id} (${d.event}): HTTP ${res.status}`);
    } catch (e) {
      console.error(`webhook ${d.id} (${d.event}):`, (e as Error).message);
    }
    const attempts = d.attempts + 1;
    deps.db.updateDelivery(d.id, attempts, ok ? null : (retryAt(attempts, deps.now()) ?? null), ok);
  }
}

/// Events a move from `from` to `to` emits; a tick that skips Paying still reports it first.
export function eventsFor(from: ApiStatus, to: ApiStatus): string[] {
  if (from === to) return [];
  const out: string[] = [];
  if (from === "open" && (to === "paid" || to === "returned")) out.push("invoice.paying");
  out.push(`invoice.${to}`);
  return out;
}

/// Reads every live API invoice from the chain and queues one webhook per transition for gateways with a URL.
export async function watchApiInvoices(deps: Deps): Promise<void> {
  for (const row of deps.db.liveApiInvoices()) {
    try {
      const inv: ChainInvoice | null = await deps.near.view(deps.cfg.gateflow, "get_invoice", { invoice: row.invoice });
      if (!inv) continue;
      const obj = invoiceObject(row.invoice, inv, await tokenMeta(deps, inv.token), deps.cfg.publicUrl, deps.now());
      const events = eventsFor(row.status as ApiStatus, obj.status);
      if (events.length === 0) continue;
      deps.db.setApiStatus(row.invoice, obj.status);
      if (!deps.db.gatewayDev(row.gateway).webhook_url) continue;
      const createdAt = new Date(deps.now()).toISOString();
      for (const event of events) deps.db.queueDelivery(row.invoice, event, JSON.stringify({ event, created_at: createdAt, data: obj }), deps.now());
    } catch (e) {
      console.error(`watcher: api invoice ${row.invoice}:`, (e as Error).message);
    }
  }
}
