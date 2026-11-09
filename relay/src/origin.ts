// Who sent a cross-chain deposit, from the origin tx (same endpoints and rules as enclave/src/origin.rs).

const EVM_RPC: Record<string, string> = {
  base: "https://base-rpc.publicnode.com",
  eth: "https://ethereum-rpc.publicnode.com",
  arb: "https://arbitrum-one-rpc.publicnode.com",
};
const SOL_RPC = "https://solana-rpc.publicnode.com";
const rpc = (url: string, method: string, params: unknown[]) => ({
  url,
  init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) },
});

/// The request that reads origin tx `hash` on `chain`, or undefined for a chain without a resolver.
export function originRequest(chain: string, hash: string): { url: string; init?: RequestInit } | undefined {
  if (EVM_RPC[chain]) return rpc(EVM_RPC[chain], "eth_getTransactionByHash", [hash]);
  if (chain === "sol") return rpc(SOL_RPC, "getTransaction", [hash, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
  if (chain === "btc") return { url: `https://blockstream.info/api/tx/${hash}` };
  if (chain === "zec") return { url: `https://api.blockchair.com/zcash/dashboards/transaction/${hash}` };
  return undefined;
}

const uniq = (xs: string[]) => [...new Set(xs)];

/// The distinct sending addresses in a response to `originRequest`, in input order; undefined when none parse.
export function parseSenders(chain: string, hash: string, body: any): string[] | undefined {
  let out: unknown[] = [];
  if (EVM_RPC[chain]) out = [body?.result?.from];
  else if (chain === "sol") out = (body?.result?.transaction?.message?.accountKeys ?? []).filter((k: any) => k?.signer === true).map((k: any) => k?.pubkey);
  else if (chain === "btc") out = (body?.vin ?? []).map((v: any) => v?.prevout?.scriptpubkey_address);
  else if (chain === "zec") out = (body?.data?.[hash]?.inputs ?? []).map((i: any) => i?.recipient);
  const addrs = out.filter((a): a is string => typeof a === "string" && a !== "").map((a) => (EVM_RPC[chain] ? a.toLowerCase() : a));
  return addrs.length ? uniq(addrs) : undefined;
}

export const CHAIN_NAMES: Record<string, string> = { eth: "Ethereum", base: "Base", arb: "Arbitrum", sol: "Solana", btc: "Bitcoin", zec: "Zcash" };

export type Origin = { chain: string; senders: string[] };

/// The stored origin of a quote, or null until its senders are known (or when the tx named none).
export function originOf(q: { origin_chain: string | null; origin_senders: string | null } | undefined): Origin | null {
  if (!q?.origin_chain || !q.origin_senders) return null;
  const senders: string[] = JSON.parse(q.origin_senders);
  return senders.length ? { chain: q.origin_chain, senders } : null;
}

/// The payer to name for a contract payment: its origin sender, else the NEAR refund account of a 1Click delivery, else the sender.
export function payerOf(p: { ref?: string | null; payer: string; refund_to: string }, origin: Origin | null): string {
  if (origin) return `${origin.senders[0]} on ${CHAIN_NAMES[origin.chain] ?? origin.chain}${origin.senders.length > 1 ? ` +${origin.senders.length - 1}` : ""}`;
  return p.ref ? p.refund_to : p.payer;
}
