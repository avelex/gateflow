// Live check (relay-from-scratch 5.1): plays a merchant against a running relay.
// Usage: RELAY_URL=http://localhost:8787 EMAIL=kaja@example.com NAME="Kaja Coffee" TOKEN=wrap.testnet node scripts/merchant.ts
import { randomBytes } from "node:crypto";
import { signDelegate } from "../src/delegate.ts";
import { type Action, secretFromSeed, signer } from "../src/near.ts";

const RELAY = process.env.RELAY_URL ?? "http://localhost:8787";
const EMAIL = process.env.EMAIL ?? `live-${Date.now()}@example.com`;
const NAME = process.env.NAME ?? `Live Check ${Date.now() % 100000}`;
const TOKEN = process.env.TOKEN ?? "wrap.testnet";
const GATEFLOW = process.env.GATEFLOW_CONTRACT;
if (!GATEFLOW) throw new Error("GATEFLOW_CONTRACT is required");
const TGAS = 10n ** 12n;

let cookie = "";
async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${RELAY}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const json: any = await res.json().catch(() => undefined);
  console.log(`${method} ${path} -> ${res.status}`, JSON.stringify(json));
  return { status: res.status, json };
}

const secret = secretFromSeed(new Uint8Array(randomBytes(32)));
const me = signer(secret);
console.log("merchant key (keep for recovery):", secret);

await api("POST", "/console/session", { email: EMAIL });
const onboard = await api("POST", "/console/onboard", { name: NAME, publicKey: me.publicKeyString });
const account: string = onboard.json.accountId;

async function relayed(actions: Action[]) {
  const p = (await api("GET", "/console/delegate-params")).json;
  const signedDelegate = signDelegate(
    { senderId: account, receiverId: GATEFLOW!, actions, nonce: BigInt(p.nonce), maxBlockHeight: BigInt(p.maxBlockHeight), publicKey: me.publicKey },
    secret,
  );
  return api("POST", "/console/relay", { signedDelegate });
}

const gw = await relayed([{ functionCall: { method: "create_gateway", args: { payout_to: account, policy: { max_risk: 50 } }, gas: 30n * TGAS, deposit: 0n } }]);
const gateway: number = gw.json.value;
const inv = await relayed([
  { functionCall: { method: "create_invoice", args: { gateway, token: TOKEN, amount: "1000000000000000000000000", expires_in_sec: 3600, memo: "relay live check" }, gas: 30n * TGAS, deposit: 0n } },
]);
const refused = await relayed([{ transfer: 1n }]);

const g = await api("GET", "/console/gateway");
const list = await api("GET", "/console/invoices");
const checkout = await api("GET", `/checkout/invoice?id=${inv.json.value}`);
const assets = await api("GET", "/checkout/assets");

const summary = {
  account,
  gateway,
  invoice: inv.json.value,
  txs: { createGateway: gw.json.txHash, createInvoice: inv.json.txHash },
  transferRefused: refused.status === 403,
  fuel: g.json.fuel,
  invoicesListed: list.json.length,
  checkoutStatus: checkout.json.status,
  checkoutMerchant: checkout.json.merchant,
  assetsHaveBtc: assets.json.some((a: any) => a.chain === "btc"),
  assetsHaveSolana: assets.json.some((a: any) => a.chain === "sol"),
};
console.log(JSON.stringify(summary, null, 2));
