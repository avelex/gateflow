import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { type Action, secretFromSeed, signer } from "./near.ts";
import { decodeSignedDelegate, delegateHashInput, refusal, signDelegate } from "./delegate.ts";

const seed = new Uint8Array(generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).subarray(16));
const secret = secretFromSeed(seed);
const pk = signer(secret).publicKey;
const TGAS = 10n ** 12n;

const invoice: Action = {
  functionCall: { method: "create_invoice", args: { gateway: 0, token: "wrap.testnet", amount: "1", expires_in_sec: 3600 }, gas: 30n * TGAS, deposit: 0n },
};

function signed(actions: Action[], sender = "kaja.op.testnet", receiver = "gateflow.testnet") {
  return decodeSignedDelegate(signDelegate({ senderId: sender, receiverId: receiver, actions, nonce: 5n, maxBlockHeight: 100n, publicKey: pk }, secret));
}

const check = (actions: Action[], sender?: string, receiver?: string) =>
  refusal(signed(actions, sender, receiver), "kaja.op.testnet", "gateflow.testnet");

test("delegate_roundtrip", () => {
  const d = signed([invoice]);
  assert.equal(d.senderId, "kaja.op.testnet");
  assert.equal(d.receiverId, "gateflow.testnet");
  assert.equal(d.nonce, 5n);
  assert.equal(d.maxBlockHeight, 100n);
  assert.equal(d.publicKey, signer(secret).publicKeyString);
  const args = new TextEncoder().encode(JSON.stringify(invoice.functionCall.args));
  assert.deepEqual(d.actions, [{ kind: "functionCall", method: "create_invoice", args, gas: 30n * TGAS, deposit: 0n }]);
});

test("delegate_hash_prefix", () => {
  const input = delegateHashInput(new Uint8Array([1, 2]));
  assert.deepEqual([...input.subarray(0, 4)], [0x6e, 0x01, 0x00, 0x40]);
});

test("allowlist_accepts_create_invoice", () => {
  assert.equal(check([invoice]), undefined);
});

test("transfer_refused", () => {
  assert.ok(check([{ transfer: 1n }]));
});

test("other_sender_refused", () => {
  assert.ok(check([invoice], "mallory.op.testnet"));
});

test("other_receiver_refused", () => {
  assert.ok(check([invoice], undefined, "wrap.testnet"));
});

test("deposit_refused", () => {
  assert.ok(check([{ functionCall: { method: "create_invoice", args: {}, gas: TGAS, deposit: 1n } }]));
});

test("gas_cap_refused", () => {
  assert.ok(check([{ functionCall: { method: "create_invoice", args: {}, gas: 101n * TGAS, deposit: 0n } }]));
  assert.equal(check([{ functionCall: { method: "create_invoice", args: {}, gas: 100n * TGAS, deposit: 0n } }]), undefined);
});

test("method_refused", () => {
  assert.ok(check([{ functionCall: { method: "fund", args: {}, gas: TGAS, deposit: 0n } }]));
});

test("mixed_actions_refused", () => {
  assert.ok(check([invoice, { addFullAccessKey: pk }]));
});

test("empty_actions_refused", () => {
  assert.ok(check([]));
});

test("garbage_is_rejected", () => {
  assert.throws(() => decodeSignedDelegate(Buffer.from("not a delegate").toString("base64")));
});

const gateway = (payout_to?: string): Action => ({
  functionCall: { method: "create_gateway", args: { payout_to, policy: { max_risk: 50 } }, gas: 30n * TGAS, deposit: 0n },
});
const OTHER_PAYOUT = "gateway must pay out to your account";

test("create_gateway_own_payout_allowed", () => {
  assert.equal(check([gateway("kaja.op.testnet")]), undefined);
});

test("create_gateway_other_payout_refused", () => {
  assert.equal(check([gateway("kaja-shop.near")]), OTHER_PAYOUT);
});

test("create_gateway_bad_args_refused", () => {
  assert.equal(check([gateway()]), OTHER_PAYOUT);
  for (const raw of ["not json", "null", "[]"]) {
    const d = signed([invoice]);
    d.actions = [{ kind: "functionCall", method: "create_gateway", args: new TextEncoder().encode(raw), gas: TGAS, deposit: 0n }];
    assert.equal(refusal(d, "kaja.op.testnet", "gateflow.testnet"), OTHER_PAYOUT);
  }
});

test("create_gateway_second_action_refused", () => {
  assert.equal(check([gateway("kaja.op.testnet"), gateway("kaja-shop.near")]), OTHER_PAYOUT);
});

test("set_payout_refused", () => {
  const a: Action = { functionCall: { method: "set_payout", args: { gateway: 0, payout_to: "kaja.op.testnet" }, gas: TGAS, deposit: 0n } };
  assert.equal(check([a]), "method set_payout is not sponsored");
});
