import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { originRequest, parseSenders } from "./origin.ts";

const fx = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const ZEC_T = "a5b08edc6ee8ea6c9c652563161be52787cd564831b0c59493c688c39f567fac";
const ZEC_S = "9cda408ce800d3fa29d1bb1383d6eedd05c31d28a3b934c97960ea49ec2cc947";

test("evm_sender_lowercase", () => {
  assert.deepEqual(parseSenders("base", "0xab", fx("evm-tx.json")), ["0xaec29d0ce4995a3e3dec32b01ca018305eb485d4"]);
  assert.deepEqual(parseSenders("arb", "0xab", { result: { from: "0x12AB" } }), ["0x12ab"]);
  assert.equal(parseSenders("eth", "0xab", { result: null }), undefined);
  const r = originRequest("base", "0xab")!;
  assert.equal(r.url, "https://base-rpc.publicnode.com");
  assert.deepEqual(JSON.parse(String(r.init!.body)), { jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: ["0xab"] });
});

test("btc_all_inputs", () => {
  // the fixture's two inputs share one address
  assert.deepEqual(parseSenders("btc", "h", fx("btc-tx.json")), ["bc1q6jqqd4ww2rjcq98zhh78v7mnjg9l78sr0s3sdp"]);
  assert.deepEqual(parseSenders("btc", "h", { vin: [{ prevout: { scriptpubkey_address: "bc1qa" } }, { prevout: { scriptpubkey_address: "bc1qb" } }] }), ["bc1qa", "bc1qb"]);
  assert.equal(originRequest("btc", "ab")!.url, "https://blockstream.info/api/tx/ab");
});

test("zec_transparent_inputs", () => {
  assert.deepEqual(parseSenders("zec", ZEC_T, fx("zec-transparent.json")), ["t1dDepmEjEsfJ1FKPs5KgNRgptNReaXkJZ5", "t1fHBMCpDJaFqsJKeEbaJYbgcb5Kx2wGq45"]);
  assert.equal(parseSenders("zec", "other", fx("zec-transparent.json")), undefined);
  assert.equal(originRequest("zec", "ab")!.url, "https://api.blockchair.com/zcash/dashboards/transaction/ab");
});

test("zec_shielded_none", () => assert.equal(parseSenders("zec", ZEC_S, fx("zec-shielded.json")), undefined));

test("unknown_chain_none", () => {
  assert.equal(originRequest("sol", "ab"), undefined);
  assert.equal(parseSenders("sol", "ab", { result: { from: "x" } }), undefined);
});
