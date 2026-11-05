// The merchant API: keys, amounts and the HTTP routes a shop server calls.
import { createHash, randomBytes } from "node:crypto";

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/// 32 random bytes in base62, padded to the 43 characters 2^256 needs.
function base62(bytes: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = B62[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out.padStart(43, "0");
}

export const newApiKey = (testnet: boolean) => `${testnet ? "gf_test_" : "gf_live_"}${base62(randomBytes(32))}`;
export const keyHash = (key: string) => createHash("sha256").update(key).digest("hex");
export const newWebhookSecret = () => `whsec_${base62(randomBytes(32))}`;

/// Raw token units of a positive decimal string; throws on zero, a sign, an exponent or more decimals than the token has.
export function toRaw(amount: string, decimals: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!m || (m[2]?.length ?? 0) > decimals) throw new Error("amount must be a positive decimal within the token's precision");
  const raw = BigInt(m[1] + (m[2] ?? "").padEnd(decimals, "0"));
  if (raw === 0n) throw new Error("amount must be positive");
  return raw;
}

/// Decimal string of raw units, with at least two decimals for amounts like `10.00`.
export function fromRaw(raw: bigint, decimals: number): string {
  const s = raw.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "").padEnd(Math.min(2, decimals), "0");
  return frac ? `${whole}.${frac}` : whole;
}

export type ApiStatus = "open" | "paying" | "paid" | "returned" | "expired";
export type ChainInvoice = { gateway: number; token: string; amount: string; expires_at_sec: number; memo: string | null; status: string; payment: number | null };

export function apiStatus(inv: Pick<ChainInvoice, "status" | "expires_at_sec">, nowMs: number): ApiStatus {
  if (inv.status === "Open") return nowMs >= inv.expires_at_sec * 1000 ? "expired" : "open";
  return inv.status.toLowerCase() as ApiStatus;
}

/// The invoice as the API, webhooks and the widget show it.
export function invoiceObject(id: number, inv: ChainInvoice, meta: { symbol: string; decimals: number }, publicUrl: string, nowMs: number) {
  return {
    id,
    url: `${publicUrl.replace(/\/$/, "")}/pay/${id}`,
    status: apiStatus(inv, nowMs),
    amount: fromRaw(BigInt(inv.amount), meta.decimals),
    currency: meta.symbol,
    order_id: inv.memo,
    expires_at: new Date(inv.expires_at_sec * 1000).toISOString(),
  };
}
