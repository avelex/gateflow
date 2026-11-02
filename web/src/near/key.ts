// The merchant's ed25519 key (design decision 4). PRF mode derives it from the passkey on every use and stores
// nothing; fallback mode keeps a non-extractable CryptoKey in IndexedDB, unlocked by a passkey prompt.
import { base58decode, base58encode } from "./borsh.ts";
import { keyFromSeed, type MerchantKey } from "./delegate.ts";

export class PrfUnsupported extends Error {}

const enc = new TextEncoder();
const MODE = "gateflow:keyMode";
const salt = () => crypto.subtle.digest("SHA-256", enc.encode("gateflow/merchant-key/v1"));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/// HKDF-SHA256(prf, salt = empty, info = "ed25519") -> 32-byte seed.
export async function seedFromPrf(prf: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const ikm = await crypto.subtle.importKey("raw", prf, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: enc.encode("ed25519") }, ikm, 256);
  return new Uint8Array(bits);
}

/// `ed25519:<base58(seed || publicKey)>`, the near-cli secret format.
export async function phraseFromSeed(seed: Uint8Array<ArrayBuffer>): Promise<string> {
  const pk = base58decode((await keyFromSeed(seed)).publicKey.slice(8));
  return `ed25519:${base58encode(new Uint8Array([...seed, ...pk]))}`;
}

/// The seed in a recovery phrase. Throws unless the phrase's public key belongs to its seed.
export async function parsePhrase(phrase: string): Promise<Uint8Array<ArrayBuffer>> {
  const m = /^ed25519:([1-9A-HJ-NP-Za-km-z]+)$/.exec(phrase.trim());
  const raw = m ? base58decode(m[1]) : undefined;
  if (!raw || raw.length !== 64) throw new Error("This is not a Gateflow recovery phrase");
  const seed = new Uint8Array(raw.slice(0, 32));
  if ((await phraseFromSeed(seed)) !== `ed25519:${m![1]}`) throw new Error("This recovery phrase is damaged");
  return seed;
}

export function assertOwner(key: MerchantKey, expected: string): void {
  if (key.publicKey !== expected) throw new Error("This passkey does not own this account");
}

export function keyMode(): "prf" | "stored" | null {
  try {
    const m = localStorage.getItem(MODE);
    return m === "prf" || m === "stored" ? m : null;
  } catch {
    return null;
  }
}

function setMode(m: "prf" | "stored") {
  try {
    localStorage.setItem(MODE, m);
  } catch {
    // ponytail: without storage, mode is re-chosen on the next sign-in.
  }
}

let ed25519: Promise<boolean> | undefined;
export function ed25519Supported(): Promise<boolean> {
  return (ed25519 ??= crypto.subtle.generateKey("Ed25519", false, ["sign"]).then(() => true, () => false));
}

// ---------- WebAuthn (thin wrappers, not unit-tested) ----------

type PrfResult = { enabled?: boolean; results?: { first?: ArrayBuffer } };
const prfOf = (c: Credential | null) => ((c as PublicKeyCredential | null)?.getClientExtensionResults() as { prf?: PrfResult })?.prf;

async function passkeyGet(withPrf: boolean): Promise<ArrayBuffer | undefined> {
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      rpId: location.hostname,
      userVerification: "required",
      extensions: withPrf ? ({ prf: { eval: { first: await salt() } } } as AuthenticationExtensionsClientInputs) : undefined,
    },
  });
  if (!cred) throw new Error("Passkey prompt was cancelled");
  return prfOf(cred)?.results?.first;
}

const keyFromPrf = async (prf: ArrayBuffer) => keyFromSeed(await seedFromPrf(new Uint8Array(prf)));

/// Creates the merchant's passkey and derives the key from its PRF output. Throws PrfUnsupported without PRF.
export async function createPasskeyKey(email: string): Promise<MerchantKey> {
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: "Gateflow", id: location.hostname },
      user: { id: random(16), name: email, displayName: email },
      challenge: random(32),
      pubKeyCredParams: [
        { type: "public-key", alg: -8 },
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      extensions: { prf: { eval: { first: await salt() } } } as AuthenticationExtensionsClientInputs,
    },
  });
  if (!cred) throw new Error("Passkey prompt was cancelled");
  const prf = prfOf(cred);
  const first = prf?.results?.first ?? (prf?.enabled ? await passkeyGet(true) : undefined);
  if (!first) throw new PrfUnsupported("This passkey cannot derive a key");
  setMode("prf");
  return keyFromPrf(first);
}

/// One passkey prompt; the returned key signs without further prompts.
export async function getPasskeyKey(): Promise<MerchantKey> {
  const first = await passkeyGet(true);
  if (!first) throw new PrfUnsupported("This passkey cannot derive a key");
  setMode("prf");
  return keyFromPrf(first);
}

// ---------- fallback key in IndexedDB ----------

type Stored = { key: CryptoKey; publicKey: string };

function db<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("gateflow", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("keys");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = run(open.result.transaction("keys", mode).objectStore("keys"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}

async function store(seed: Uint8Array<ArrayBuffer>): Promise<MerchantKey> {
  const { publicKey } = await keyFromSeed(seed);
  const key = await crypto.subtle.importKey("pkcs8", new Uint8Array([...PKCS8, ...seed]), "Ed25519", false, ["sign"]);
  await db("readwrite", (s) => s.put({ key, publicKey } satisfies Stored, "merchant"));
  setMode("stored");
  return unlocked({ key, publicKey });
}

const PKCS8 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];

/// The stored key; each signature first asks for the passkey as the confirmation prompt.
const unlocked = ({ key, publicKey }: Stored): MerchantKey => ({
  publicKey,
  sign: async (msg) => {
    await passkeyGet(false);
    return new Uint8Array(await crypto.subtle.sign("Ed25519", key, msg));
  },
});

export async function createFallbackKey(): Promise<{ key: MerchantKey; phrase: string }> {
  const seed = random(32);
  const phrase = await phraseFromSeed(seed);
  return { key: await store(seed), phrase };
}

export async function restoreFallbackKey(phrase: string): Promise<MerchantKey> {
  return store(await parsePhrase(phrase));
}

export async function loadStoredKey(): Promise<MerchantKey | null> {
  try {
    const s = await db<Stored | undefined>("readonly", (st) => st.get("merchant"));
    return s ? unlocked(s) : null;
  } catch {
    return null;
  }
}
