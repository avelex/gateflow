// The merchant's NEP-366 signed delegate actions, signed in WebCrypto.
import { base58encode, delegateHashInput, encodeDelegateAction, encodeSignedDelegate, type FunctionCall, type KeyAction } from "./borsh.ts";

export type DelegateParams = { senderId: string; receiverId: string; nonce: bigint; maxBlockHeight: bigint; actions: (FunctionCall | KeyAction)[] };
export type MerchantKey = { publicKey: string; sign(msg: Uint8Array<ArrayBuffer>): Promise<Uint8Array> };

const PKCS8_ED25519 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const bytes = (b: ArrayBuffer | Uint8Array) => new Uint8Array(b);

/// A MerchantKey from a 32-byte ed25519 seed. The public key is read once; the signing key is non-extractable.
export async function keyFromSeed(seed: Uint8Array): Promise<MerchantKey> {
  const pkcs8 = new Uint8Array([...PKCS8_ED25519, ...seed]);
  const readable = await crypto.subtle.importKey("pkcs8", pkcs8, "Ed25519", true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", readable);
  const signing = await crypto.subtle.importKey("pkcs8", pkcs8, "Ed25519", false, ["sign"]);
  return {
    publicKey: `ed25519:${base58encode(b64url(jwk.x!))}`,
    sign: async (msg) => bytes(await crypto.subtle.sign("Ed25519", signing, msg)),
  };
}

/// Base64 Borsh SignedDelegate for `p`, signed by `key`.
export async function signDelegate(key: MerchantKey, p: DelegateParams): Promise<string> {
  const body = encodeDelegateAction({ ...p, publicKey: key.publicKey });
  const hash = bytes(await crypto.subtle.digest("SHA-256", delegateHashInput(body)));
  const signed = encodeSignedDelegate(body, await key.sign(hash));
  return btoa(String.fromCharCode(...signed));
}
