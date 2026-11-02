import { expect, test } from "vitest";
import { decodeSignedDelegate, signDelegate as relaySign } from "../../../relay/src/delegate.ts";
import { publicKeyBytes, secretFromSeed } from "../../../relay/src/near.ts";
import { base58decode, base58encode, delegateHashInput, encodeDelegateAction } from "./borsh.ts";
import { type DelegateParams, keyFromSeed, signDelegate } from "./delegate.ts";

const seed = new Uint8Array(32).map((_, i) => i + 1);
const params: DelegateParams = {
  senderId: "kaja-coffee.gateflow-op-v1.testnet",
  receiverId: "gateflow-dev-v1.testnet",
  nonce: 42n,
  maxBlockHeight: 123456789n,
  actions: [{ method: "create_invoice", args: { gateway: 0, token: "wrap.testnet", amount: "1000000000000000000000000", expires_in_sec: 3600 }, gas: 30n * 10n ** 12n }],
};

test("base58_roundtrip", () => {
  const b = new Uint8Array([0, 0, 1, 2, 255, 128, 0]);
  expect(base58decode(base58encode(b))).toEqual(b);
  expect(base58encode(new Uint8Array([0, 0]))).toBe("11");
});

test("delegate_hash_prefix", async () => {
  const key = await keyFromSeed(seed);
  const input = delegateHashInput(encodeDelegateAction({ ...params, publicKey: key.publicKey }));
  expect([...input.slice(0, 4)]).toEqual([0x6e, 0x01, 0x00, 0x40]);
});

test("delegate_matches_relay", async () => {
  const key = await keyFromSeed(seed);
  const secret = secretFromSeed(seed);
  const expected = relaySign(
    {
      ...params,
      actions: params.actions.map((a) => ({ functionCall: { method: a.method, args: a.args, gas: a.gas, deposit: 0n } })),
      publicKey: publicKeyBytes(key.publicKey),
    },
    secret,
  );
  expect(await signDelegate(key, params)).toBe(expected);
});

test("relay_decodes_web_delegate", async () => {
  const key = await keyFromSeed(seed);
  const d = decodeSignedDelegate(await signDelegate(key, params));
  expect(d.senderId).toBe(params.senderId);
  expect(d.receiverId).toBe(params.receiverId);
  expect(d.nonce).toBe(42n);
  expect(d.publicKey).toBe(key.publicKey);
  expect(d.actions).toEqual([{ kind: "functionCall", method: "create_invoice", gas: 30n * 10n ** 12n, deposit: 0n }]);
});
