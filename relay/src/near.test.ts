import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { base58decode, base58encode, encodeActions, signer, txResult, secretFromSeed } from "./near.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

const u128le = (n: bigint) => {
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Number((n >> BigInt(8 * i)) & 0xffn);
  return [...b];
};

test("base58_roundtrip", () => {
  for (const bytes of [new Uint8Array([0, 0, 1, 2, 255]), new Uint8Array(32).fill(7), new Uint8Array([])]) {
    assert.deepEqual(base58decode(base58encode(bytes)), bytes);
  }
  assert.equal(base58encode(new Uint8Array([0, 0, 1])), "112");
});

test("actions_borsh_create_account", () => {
  assert.deepEqual([...encodeActions([{ createAccount: true }])], [1, 0, 0, 0, 0]);
});

test("actions_borsh_transfer", () => {
  assert.deepEqual([...encodeActions([{ transfer: 10n ** 22n }])], [1, 0, 0, 0, 3, ...u128le(10n ** 22n)]);
});

test("actions_borsh_add_full_access_key", () => {
  const pk = new Uint8Array(32).fill(9);
  assert.deepEqual([...encodeActions([{ addFullAccessKey: pk }])], [1, 0, 0, 0, 5, 0, ...pk, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
});

test("actions_borsh_function_call_deposit", () => {
  const bytes = [...encodeActions([{ functionCall: { method: "fund", args: { gateway: 0 }, gas: 30n * 10n ** 12n, deposit: 5n } }])];
  const args = [...new TextEncoder().encode('{"gateway":0}')];
  const gas = u128le(30n * 10n ** 12n).slice(0, 8);
  assert.deepEqual(bytes, [1, 0, 0, 0, 2, 4, 0, 0, 0, ...new TextEncoder().encode("fund"), args.length, 0, 0, 0, ...args, ...gas, ...u128le(5n)]);
});

test("signature_verifies", () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(16);
  const s = signer(secretFromSeed(new Uint8Array(seed)));
  const msg = new TextEncoder().encode("hello");
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(s.publicKey)]);
  assert.ok(verify(null, msg, createPublicKey({ key: spki, format: "der", type: "spki" }), s.sign(msg)));
  assert.match(s.publicKeyString, /^ed25519:/);
});

test("tx_result_panic", () => {
  const r = txResult(fixture("tx-panic.json"), "gateflow.testnet");
  assert.equal(r.error, "invalid expiry");
  assert.equal(r.hash, "9fq2Rw7eWb8pAZ6p1u1Y5Jc3KyEw1CQx3Ur3aWv1bQSb");
});

test("tx_result_value", () => {
  const r = txResult(fixture("tx-success.json"), "gateflow.testnet");
  assert.equal(r.value, 3);
  assert.equal(r.error, undefined);
});

test("tx_result_top_level_failure", () => {
  const rpc = { result: { status: { Failure: { InvalidTxError: { InvalidNonce: {} } } }, transaction: { hash: "h" }, receipts_outcome: [] } };
  assert.match(txResult(rpc, "gateflow.testnet").error ?? "", /InvalidNonce/);
});
