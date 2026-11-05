// NEAR transactions by hand: base58, Borsh, ed25519 signing (node:crypto) and a small JSON-RPC client.
import { createHash, createPrivateKey, createPublicKey, sign as edSign } from "node:crypto";

// ---------- base58 ----------

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

// ---------- Borsh ----------

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
  u64(n: bigint) {
    return this.uint(n, 8);
  }
  u128(n: bigint) {
    return this.uint(n, 16);
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
  publicKey(pk: Uint8Array) {
    return this.u8(0).raw(pk);
  }
  done(): Uint8Array {
    return new Uint8Array(this.parts);
  }
}

export type Action =
  | { createAccount: true }
  | { transfer: bigint }
  | { addFullAccessKey: Uint8Array }
  | { functionCall: { method: string; args: object; gas: bigint; deposit: bigint } }
  | { signedDelegate: Uint8Array };

export function writeAction(w: Writer, a: Action): void {
  if ("createAccount" in a) w.u8(0);
  else if ("functionCall" in a) {
    const f = a.functionCall;
    w.u8(2).string(f.method).bytes(new TextEncoder().encode(JSON.stringify(f.args))).u64(f.gas).u128(f.deposit);
  } else if ("transfer" in a) w.u8(3).u128(a.transfer);
  else if ("addFullAccessKey" in a) w.u8(5).publicKey(a.addFullAccessKey).u64(0n).u8(1);
  else w.u8(8).raw(a.signedDelegate);
}

export function encodeActions(actions: Action[]): Uint8Array {
  const w = new Writer().u32(actions.length);
  for (const a of actions) writeAction(w, a);
  return w.done();
}

export const sha256 = (b: Uint8Array): Uint8Array => new Uint8Array(createHash("sha256").update(b).digest());

// ---------- keys ----------

const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");

export type Signer = { publicKey: Uint8Array; publicKeyString: string; sign(msg: Uint8Array): Uint8Array };

/// `ed25519:<base58(seed || publicKey)>`, the near-cli secret format.
export function secretFromSeed(seed: Uint8Array): string {
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: "der", type: "pkcs8" });
  const pk = createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12);
  return `ed25519:${base58encode(new Uint8Array([...seed, ...pk]))}`;
}

export function signer(secret: string): Signer {
  const raw = base58decode(secret.replace(/^ed25519:/, ""));
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, raw.subarray(0, 32)]), format: "der", type: "pkcs8" });
  const publicKey = new Uint8Array(createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12));
  return {
    publicKey,
    publicKeyString: `ed25519:${base58encode(publicKey)}`,
    sign: (msg) => new Uint8Array(edSign(null, msg, key)),
  };
}

export const publicKeyBytes = (pk: string): Uint8Array => base58decode(pk.replace(/^ed25519:/, ""));

// ---------- transaction results ----------

export type TxResult = { hash: string; value?: unknown; error?: string };

function failureText(failure: any): string {
  const exec = failure?.ActionError?.kind?.FunctionCallError?.ExecutionError;
  if (typeof exec === "string") return exec.replace(/^Smart contract panicked: /, "");
  return JSON.stringify(failure);
}

/// Hash, plus the outcome of the receipt run by `executor`: its decoded JSON return value or its panic text.
export function txResult(rpc: any, executor: string): TxResult {
  const r = rpc.result ?? rpc;
  const hash: string = r.transaction?.hash ?? "";
  const receipt = (r.receipts_outcome ?? []).find((o: any) => o.outcome?.executor_id === executor);
  const status = receipt?.outcome?.status ?? r.status ?? {};
  if (status.Failure) return { hash, error: failureText(status.Failure) };
  if (r.status?.Failure) return { hash, error: failureText(r.status.Failure) };
  const b64 = status.SuccessValue;
  if (typeof b64 === "string" && b64.length > 0) {
    const text = Buffer.from(b64, "base64").toString("utf8");
    try {
      return { hash, value: JSON.parse(text) };
    } catch {
      return { hash, value: text };
    }
  }
  return { hash };
}

// ---------- RPC client ----------

export interface Near {
  view(contract: string, method: string, args: object): Promise<any>;
  /// Signs and sends as the operator. `executor` picks the receipt whose result is reported (default `receiver`).
  send(receiver: string, actions: Action[], executor?: string): Promise<TxResult>;
  accountExists(id: string): Promise<boolean>;
  accessKey(account: string, publicKey: string): Promise<{ nonce: bigint } | undefined>;
  head(): Promise<{ height: bigint; hash: Uint8Array }>;
  /// The final tx status result, or undefined when the RPC does not know the tx (yet).
  tx(hash: string, sender: string): Promise<any | undefined>;
  /// A block's timestamp, in whole UTC seconds.
  block(hash: string): Promise<{ timestampSec: number }>;
}

export class RpcError extends Error {
  cause: any;
  constructor(message: string, cause: any) {
    super(message);
    this.cause = cause;
  }
}

export function rpcNear(cfg: { rpcUrl: string; accountId: string; secret?: string }): Near {
  const call = async (method: string, params: object): Promise<any> => {
    const res = await fetch(cfg.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "gateflow", method, params }),
    });
    const body: any = await res.json();
    if (body.error) throw new RpcError(body.error.cause?.name ?? body.error.message ?? "rpc error", body.error);
    return body.result;
  };

  const accessKey = async (account: string, publicKey: string) => {
    try {
      const r = await call("query", { request_type: "view_access_key", finality: "final", account_id: account, public_key: publicKey });
      return { nonce: BigInt(r.nonce), blockHash: base58decode(r.block_hash) };
    } catch (e) {
      if (e instanceof RpcError && /UNKNOWN_(ACCESS_KEY|ACCOUNT)/.test(e.message)) return undefined;
      throw e;
    }
  };

  let queue: Promise<unknown> = Promise.resolve();
  const op = cfg.secret ? signer(cfg.secret) : undefined;

  const sendNow = async (receiver: string, actions: Action[], executor: string): Promise<TxResult> => {
    if (!op) throw new Error("RELAY_PRIVATE_KEY is not set");
    const key = await accessKey(cfg.accountId, op.publicKeyString);
    if (!key) throw new Error(`no access key for ${cfg.accountId}`);
    const tx = new Writer()
      .string(cfg.accountId)
      .publicKey(op.publicKey)
      .u64(key.nonce + 1n)
      .string(receiver)
      .raw(key.blockHash)
      .raw(encodeActions(actions))
      .done();
    const signed = new Writer().raw(tx).u8(0).raw(op.sign(sha256(tx))).done();
    try {
      const r = await call("send_tx", { signed_tx_base64: Buffer.from(signed).toString("base64"), wait_until: "FINAL" });
      return txResult(r, executor);
    } catch (e) {
      if (e instanceof RpcError) return { hash: "", error: JSON.stringify(e.cause?.data ?? e.cause) };
      throw e;
    }
  };

  return {
    async view(contract, method, args) {
      const r = await call("query", {
        request_type: "call_function",
        finality: "final",
        account_id: contract,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      });
      const text = Buffer.from(r.result).toString("utf8");
      return text ? JSON.parse(text) : null;
    },
    send(receiver, actions, executor = receiver) {
      // ponytail: one global queue for operator txs (one nonce stream); per-key queues if throughput matters.
      const p = queue.then(() => sendNow(receiver, actions, executor));
      queue = p.catch(() => {});
      return p;
    },
    async accountExists(id) {
      try {
        await call("query", { request_type: "view_account", finality: "final", account_id: id });
        return true;
      } catch (e) {
        if (e instanceof RpcError && /UNKNOWN_ACCOUNT/.test(e.message + JSON.stringify(e.cause))) return false;
        throw e;
      }
    },
    async accessKey(account, publicKey) {
      const k = await accessKey(account, publicKey);
      return k && { nonce: k.nonce };
    },
    async head() {
      const r = await call("block", { finality: "final" });
      return { height: BigInt(r.header.height), hash: base58decode(r.header.hash) };
    },
    async block(hash) {
      const r = await call("block", { block_id: hash });
      return { timestampSec: Math.floor(Number(r.header.timestamp) / 1e9) };
    },
    async tx(hash, sender) {
      try {
        return await call("EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" });
      } catch (e) {
        if (e instanceof RpcError && /UNKNOWN_TRANSACTION/.test(e.message + JSON.stringify(e.cause))) return undefined;
        throw e;
      }
    },
  };
}
