// The merchant API: keys, amounts and the HTTP routes a shop server calls.
import { createHash, randomBytes } from "node:crypto";

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/// 32 random bytes in base62, padded to the 43 characters 2^256 needs.
function base62(bytes: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = B62[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out.padStart(43, "0");
}

export const newApiKey = (testnet: boolean) => `${testnet ? "gf_test_" : "gf_live_"}${base62(randomBytes(32))}`;
export const keyHash = (key: string) => createHash("sha256").update(key).digest("hex");
export const newWebhookSecret = () => `whsec_${base62(randomBytes(32))}`;
