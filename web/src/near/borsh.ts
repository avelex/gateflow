// Base58 and the Borsh subset for NEP-366 delegate actions, ported from relay/src/near.ts and relay/src/delegate.ts
// without node:crypto. delegate.test.ts checks the bytes against the relay's own encoder.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58encode(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    out += "1";
  }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

export function base58decode(s: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of s) {
    let carry = ALPHABET.indexOf(ch);
    if (carry < 0) throw new Error(`invalid base58 character ${ch}`);
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

export class Writer {
  parts: number[] = [];
  u8(n: number) {
    this.parts.push(n & 0xff);
    return this;
  }
  u32(n: number) {
    for (let i = 0; i < 4; i++) this.parts.push((n >>> (8 * i)) & 0xff);
    return this;
  }
  uint(n: bigint, bytes: number) {
    for (let i = 0; i < bytes; i++) this.parts.push(Number((n >> BigInt(8 * i)) & 0xffn));
    return this;
  }
  raw(b: Uint8Array) {
    for (const x of b) this.parts.push(x);
    return this;
  }
  bytes(b: Uint8Array) {
    return this.u32(b.length).raw(b);
  }
  string(s: string) {
    return this.bytes(new TextEncoder().encode(s));
  }
  done(): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.parts);
  }
}

export type FunctionCall = { method: string; args: object; gas: bigint };
/// AddKey with a FunctionCall permission, or DeleteKey (the merchant API's invoice signer key).
export type KeyAction = { addKey: { publicKey: string; allowance: bigint | null; receiver: string; methods: string[] } } | { deleteKey: string };

const keyBytes = (pk: string) => base58decode(pk.replace(/^ed25519:/, ""));

/// Borsh `DelegateAction` with zero-deposit FunctionCall actions or key actions.
export function encodeDelegateAction(d: {
  senderId: string;
  receiverId: string;
  nonce: bigint;
  maxBlockHeight: bigint;
  actions: (FunctionCall | KeyAction)[];
  publicKey: string;
}): Uint8Array<ArrayBuffer> {
  const w = new Writer().string(d.senderId).string(d.receiverId).u32(d.actions.length);
  for (const a of d.actions) {
    if ("method" in a) w.u8(2).string(a.method).bytes(new TextEncoder().encode(JSON.stringify(a.args))).uint(a.gas, 8).uint(0n, 16);
    else if ("deleteKey" in a) w.u8(6).u8(0).raw(keyBytes(a.deleteKey));
    else {
      const k = a.addKey;
      w.u8(5).u8(0).raw(keyBytes(k.publicKey)).uint(0n, 8).u8(0);
      if (k.allowance === null) w.u8(0);
      else w.u8(1).uint(k.allowance, 16);
      w.string(k.receiver).u32(k.methods.length);
      for (const m of k.methods) w.string(m);
    }
  }
  return w.uint(d.nonce, 8).uint(d.maxBlockHeight, 8).u8(0).raw(keyBytes(d.publicKey)).done();
}

/// `u32le(2^30 + 366) || borsh(DelegateAction)`, the NEP-366 signing input before sha256.
export const delegateHashInput = (body: Uint8Array): Uint8Array<ArrayBuffer> => new Writer().u32(2 ** 30 + 366).raw(body).done();

/// Borsh `SignedDelegateAction`: the delegate action, then an ed25519 signature (tag 0).
export const encodeSignedDelegate = (body: Uint8Array, signature: Uint8Array): Uint8Array<ArrayBuffer> => new Writer().raw(body).u8(0).raw(signature).done();
