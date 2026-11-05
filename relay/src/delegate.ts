// NEP-366 signed delegate actions: decoding (for the sponsorship allowlist) and signing (for tests and scripts).
import { type Action, base58encode, sha256, signer, writeAction, Writer } from "./near.ts";

export type DecodedAction =
  | { kind: "functionCall"; method: string; args: Uint8Array; gas: bigint; deposit: bigint }
  | { kind: "addKey"; publicKey: string; permission: KeyPermission }
  | { kind: "deleteKey"; publicKey: string }
  | { kind: "other"; tag: number };

export type KeyPermission = { fullAccess: true } | { allowance: bigint | null; receiver: string; methods: string[] };

export type DelegateAction = {
  senderId: string;
  receiverId: string;
  actions: DecodedAction[];
  nonce: bigint;
  maxBlockHeight: bigint;
  publicKey: string;
  /// The whole SignedDelegateAction, ready to wrap in a Delegate action.
  raw: Uint8Array;
};

export const ALLOWED_METHODS = ["create_gateway", "create_invoice", "set_policy"];
export const MAX_GAS = 100n * 10n ** 12n;
/// Allowance of the invoice signer key. ponytail: unlimited until the testnet spike (task 0.1) shows delegate actions spend it.
export const SIGNER_ALLOWANCE: bigint | null = null;
export const SIGNER_METHODS = ["create_invoice"];

class Reader {
  b: Uint8Array;
  at = 0;
  constructor(b: Uint8Array) {
    this.b = b;
  }
  take(n: number): Uint8Array {
    if (this.at + n > this.b.length) throw new Error("truncated delegate action");
    const out = this.b.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }
  u8() {
    return this.take(1)[0];
  }
  u32() {
    const b = this.take(4);
    return (b[0] | (b[1] << 8) | (b[2] << 16)) + b[3] * 2 ** 24;
  }
  uint(bytes: number) {
    const b = this.take(bytes);
    let n = 0n;
    for (let i = bytes - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]);
    return n;
  }
  bytes() {
    return this.take(this.u32());
  }
  string() {
    return new TextDecoder("utf-8", { fatal: true }).decode(this.bytes());
  }
  publicKey(): string {
    const type = this.u8();
    if (type === 0) return `ed25519:${base58encode(this.take(32))}`;
    if (type === 1) return `secp256k1:${base58encode(this.take(64))}`;
    throw new Error("unknown key type");
  }
  signature() {
    const type = this.u8();
    this.take(type === 0 ? 64 : 65);
  }
}

function readAction(r: Reader): DecodedAction {
  const tag = r.u8();
  switch (tag) {
    case 0: // CreateAccount
      break;
    case 1: // DeployContract
      r.bytes();
      break;
    case 2: {
      const method = r.string();
      const args = r.bytes().slice();
      return { kind: "functionCall", method, args, gas: r.uint(8), deposit: r.uint(16) };
    }
    case 3: // Transfer
      r.uint(16);
      break;
    case 4: // Stake
      r.uint(16);
      r.publicKey();
      break;
    case 5: {
      // AddKey
      const publicKey = r.publicKey();
      r.uint(8);
      if (r.u8() !== 0) return { kind: "addKey", publicKey, permission: { fullAccess: true } };
      const allowance = r.u8() === 1 ? r.uint(16) : null;
      const receiver = r.string();
      const methods: string[] = [];
      for (let i = r.u32(); i > 0; i--) methods.push(r.string());
      return { kind: "addKey", publicKey, permission: { allowance, receiver, methods } };
    }
    case 6:
      return { kind: "deleteKey", publicKey: r.publicKey() };
    case 7: // DeleteAccount
      r.string();
      break;
    default:
      throw new Error(`unsupported action ${tag}`);
  }
  return { kind: "other", tag };
}

export function decodeSignedDelegate(b64: string): DelegateAction {
  const raw = new Uint8Array(Buffer.from(b64, "base64"));
  const r = new Reader(raw);
  const senderId = r.string();
  const receiverId = r.string();
  const count = r.u32();
  if (count > 32) throw new Error("too many actions");
  const actions: DecodedAction[] = [];
  for (let i = 0; i < count; i++) actions.push(readAction(r));
  const nonce = r.uint(8);
  const maxBlockHeight = r.uint(8);
  const publicKey = r.publicKey();
  r.signature();
  if (r.at !== raw.length) throw new Error("trailing bytes after delegate action");
  return { senderId, receiverId, actions, nonce, maxBlockHeight, publicKey, raw };
}

/// Why the operator must not sponsor this delegate action, or `undefined` when it is allowed.
/// `payout_to` from `create_gateway` JSON args; undefined when the args are not a JSON object.
function payoutOf(args: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(args))?.payout_to;
  } catch {
    return undefined;
  }
}

/// Why the relay won't sponsor `d`, or undefined. On the merchant's own account only the invoice signer key may be added or deleted.
export function refusal(d: DelegateAction, sessionAccount: string, gateflow: string, signerPub?: string): string | undefined {
  if (d.senderId !== sessionAccount) return "sender is not your account";
  if (d.receiverId === sessionAccount) return keyRefusal(d, gateflow, signerPub);
  if (d.receiverId !== gateflow) return "receiver is not the Gateflow contract";
  if (d.actions.length === 0) return "no actions";
  for (const a of d.actions) {
    if (a.kind !== "functionCall") return "only function calls are sponsored";
    if (!ALLOWED_METHODS.includes(a.method)) return `method ${a.method} is not sponsored`;
    if (a.deposit !== 0n) return "deposits are not sponsored";
    if (a.gas > MAX_GAS) return "gas above 100 Tgas";
    if (a.method === "create_gateway" && payoutOf(a.args) !== d.senderId) return "gateway must pay out to your account";
  }
  return undefined;
}

function keyRefusal(d: DelegateAction, gateflow: string, signerPub?: string): string | undefined {
  if (!signerPub) return "the API is not available on this relay";
  if (d.actions.length !== 1) return "only one key action is sponsored";
  const a = d.actions[0];
  if (a.kind === "deleteKey") return a.publicKey === signerPub ? undefined : "only the invoice signer key can be deleted";
  if (a.kind !== "addKey") return "only the invoice signer key can be added";
  if (a.publicKey !== signerPub) return "only the invoice signer key can be added";
  const p = a.permission;
  const exact = !("fullAccess" in p) && p.allowance === SIGNER_ALLOWANCE && p.receiver === gateflow && p.methods.length === 1 && p.methods[0] === SIGNER_METHODS[0];
  return exact ? undefined : "the invoice signer key must call only create_invoice on Gateflow";
}

/// `u32le(2^30 + 366) || borsh(DelegateAction)`, the NEP-366 signing input before sha256.
export function delegateHashInput(delegateBorsh: Uint8Array): Uint8Array {
  return new Writer().u32(2 ** 30 + 366).raw(delegateBorsh).done();
}

export function encodeDelegateAction(d: {
  senderId: string;
  receiverId: string;
  actions: Action[];
  nonce: bigint;
  maxBlockHeight: bigint;
  publicKey: Uint8Array;
}): Uint8Array {
  const w = new Writer().string(d.senderId).string(d.receiverId).u32(d.actions.length);
  for (const a of d.actions) writeAction(w, a);
  return w.u64(d.nonce).u64(d.maxBlockHeight).publicKey(d.publicKey).done();
}

/// Base64 SignedDelegateAction signed with `secret` (near-cli format).
export function signDelegate(d: Parameters<typeof encodeDelegateAction>[0], secret: string): string {
  const body = encodeDelegateAction(d);
  const sig = signer(secret).sign(sha256(delegateHashInput(body)));
  return Buffer.from(new Writer().raw(body).u8(0).raw(sig).done()).toString("base64");
}
