// Images from the design exports. No icons are drawn that the exports do not have.
// Chain icons live in public/img so merchant sites (the example shop's pay button) can load them from the relay too.
const img = (name: string): string => `/img/chain-${name}.png`;
const [arbitrum, base, bitcoin, ethereum, near, usdc, zcash] = ["arbitrum", "base", "bitcoin", "ethereum", "near", "usdc", "zcash"].map(img);
export { default as logo } from "./assets/logo.png";
export { near as nearLogo };

const CHAINS: Record<string, string> = { near, eth: ethereum, base, arb: arbitrum, btc: bitcoin, zec: zcash };
const TOKENS: Record<string, string> = { USDC: usdc, nBTC: bitcoin, BTC: bitcoin, ZEC: zcash };

export const chainIcon = (chain: string): string | undefined => CHAINS[chain];
export const tokenIcon = (symbol: string): string | undefined => TOKENS[symbol];

export const CHAIN_NAMES: Record<string, string> = { near: "NEAR", eth: "Ethereum", base: "Base", arb: "Arbitrum", btc: "Bitcoin", zec: "Zcash" };
export const chainName = (chain: string): string => CHAIN_NAMES[chain] ?? chain;
