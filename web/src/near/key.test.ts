import { expect, test } from "vitest";
import { secretFromSeed, signer } from "../../../relay/src/near.ts";
import { base58decode, base58encode } from "./borsh.ts";
import { keyFromSeed } from "./delegate.ts";
import { assertOwner, parsePhrase, phraseFromSeed, seedFromPrf } from "./key.ts";

const seed = new Uint8Array(32).map((_, i) => 200 - i);

test("seed_from_prf_deterministic", async () => {
  const a = new Uint8Array(32).fill(7);
  const b = new Uint8Array(32).fill(8);
  expect(await seedFromPrf(a)).toEqual(await seedFromPrf(a));
  expect(await seedFromPrf(a)).not.toEqual(await seedFromPrf(b));
  expect((await seedFromPrf(a)).length).toBe(32);
});

test("public_key_matches_seed", async () => {
  expect((await keyFromSeed(seed)).publicKey).toBe(signer(secretFromSeed(seed)).publicKeyString);
});

test("recovery_phrase_roundtrip", async () => {
  const phrase = await phraseFromSeed(seed);
  expect(phrase).toBe(secretFromSeed(seed));
  const back = await parsePhrase(phrase);
  expect(back).toEqual(seed);
  expect((await keyFromSeed(back)).publicKey).toBe((await keyFromSeed(seed)).publicKey);
});

test("phrase_rejects_mismatched_pk", async () => {
  const raw = base58decode((await phraseFromSeed(seed)).slice(8));
  raw[63] ^= 1;
  await expect(parsePhrase(`ed25519:${base58encode(raw)}`)).rejects.toThrow();
  await expect(parsePhrase("ed25519:abc")).rejects.toThrow();
  await expect(parsePhrase("not a phrase")).rejects.toThrow();
});

test("owner_mismatch_throws", async () => {
  const key = await keyFromSeed(seed);
  expect(() => assertOwner(key, key.publicKey)).not.toThrow();
  expect(() => assertOwner(key, "ed25519:11111111111111111111111111111111")).toThrow("This passkey does not own this account");
});

import { afterEach, vi } from "vitest";
import { getPasskeyKey, keyMode, restoreFallbackKey } from "./key.ts";

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

function fakeDevice(mode: string) {
  const storage = new MemStorage();
  storage.setItem("gateflow:keyMode", mode);
  const create = vi.fn(async () => ({ getClientExtensionResults: () => ({}) }));
  const get = vi.fn(async () => ({ getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).fill(9).buffer } } }) }));
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("location", { hostname: "localhost" });
  vi.stubGlobal("navigator", { credentials: { create, get } });
  return { create };
}
afterEach(() => vi.unstubAllGlobals());

test("resume_passkey_keeps_mode_until_owner_checked", async () => {
  fakeDevice("stored");
  await getPasskeyKey();
  expect(keyMode()).toBe("stored");
});

test("restore_rejects_other_accounts_phrase", async () => {
  const { create } = fakeDevice("prf");
  const phrase = await phraseFromSeed(seed);
  const other = (await keyFromSeed(new Uint8Array(32).fill(3))).publicKey;
  await expect(restoreFallbackKey(phrase, "kaja@example.com", other)).rejects.toThrow("This recovery phrase does not own this account");
  expect(keyMode()).toBe("prf");
  expect(create).not.toHaveBeenCalled();
});
