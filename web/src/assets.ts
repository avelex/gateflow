// Images from the design exports. No icons are drawn that the exports do not have.
import arbitrum from "./assets/chain-arbitrum.png";
import base from "./assets/chain-base.png";
import bitcoin from "./assets/chain-bitcoin.png";
import ethereum from "./assets/chain-ethereum.png";
import near from "./assets/chain-near.png";
import usdc from "./assets/chain-usdc.png";
import zcash from "./assets/chain-zcash.png";
export { default as logo } from "./assets/logo.png";
export { near as nearLogo };

const CHAINS: Record<string, string> = { near, eth: ethereum, base, arb: arbitrum, btc: bitcoin, zec: zcash };
const TOKENS: Record<string, string> = { USDC: usdc, nBTC: bitcoin, BTC: bitcoin, ZEC: zcash };

export const chainIcon = (chain: string): string | undefined => CHAINS[chain];
export const tokenIcon = (symbol: string): string | undefined => TOKENS[symbol];

export const CHAIN_NAMES: Record<string, string> = { near: "NEAR", eth: "Ethereum", base: "Base", arb: "Arbitrum", btc: "Bitcoin", zec: "Zcash" };
export const chainName = (chain: string): string => CHAIN_NAMES[chain] ?? chain;
