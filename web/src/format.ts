/// Raw token units as a decimal string, trailing zeros trimmed. String math only.
export function formatAmount(raw: bigint, decimals: number): string {
  const s = raw.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/// Decimal text to raw units. Throws on non-digits, more than `decimals` fraction digits, or zero.
export function parseAmount(text: string, decimals: number): bigint {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(text.trim());
  if (!m || !(m[1] || m[2])) throw new Error("enter an amount");
  const frac = m[2] ?? "";
  if (frac.length > decimals) throw new Error(`at most ${decimals} decimals`);
  const raw = BigInt((m[1] || "0") + frac.padEnd(decimals, "0"));
  if (raw === 0n) throw new Error("amount must be above zero");
  return raw;
}

// Same rule as relay/src/checkout.ts.
const NEAR_ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export const isNearAccount = (s: string): boolean => s.length >= 2 && s.length <= 64 && NEAR_ACCOUNT.test(s);

/// A time of day in UTC: "05:50:41 UTC".
export const utcTime = (sec: number): string => `${new Date(sec * 1000).toISOString().slice(11, 19)} UTC`;

/// Countdown text: "1h 05m", "4m 09s", "45s", "0s".
export function timeLeft(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const two = (n: number) => String(n).padStart(2, "0");
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${two(Math.floor((s % 3600) / 60))}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${two(s % 60)}s`;
  return `${s}s`;
}

/// Avatar initials: the first letters of the first two words.
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "G";
