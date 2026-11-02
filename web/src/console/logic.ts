// Pure console rules (tested in logic.test.ts) and the delegate round trip.
import { api } from "../api.ts";
import { type DelegateParams, type MerchantKey, signDelegate } from "../near/delegate.ts";
import { assertOwner, getPasskeyKey, loadStoredKey } from "../near/key.ts";

export type Step = "account" | "tokens" | "gateway" | "done";
export type Me = { email: string; name: string | null; accountId: string | null; gatewayId: number | null; step: Step };

export const TGAS = 10n ** 12n;

/// Which onboarding card to show for the backend step and the key this browser can reach.
export function onboardingScreen(step: string, mode: "prf" | "stored" | null): "details" | "resume-key" | "gateway" | "done" {
  if (step === "done") return "done";
  if (step === "account") return "details";
  if (!mode) return "resume-key";
  return step === "gateway" ? "gateway" : "details";
}

/// The merchant key for one signed action: one passkey prompt in either mode.
export async function acquireKey(mode: "prf" | "stored" | null): Promise<MerchantKey> {
  if (mode === "stored") {
    const k = await loadStoredKey();
    if (k) return k;
    throw new Error("No merchant key on this device. Restore it with your recovery phrase.");
  }
  return getPasskeyKey();
}

type Params = { nonce: string; maxBlockHeight: string; publicKey: string; senderId: string; receiverId: string };

/// Signs `actions` as the merchant and has the relay submit them.
export async function signAndRelay(key: MerchantKey, actions: DelegateParams["actions"]): Promise<{ txHash: string; value: unknown }> {
  const p = await api<Params>("GET", "/console/delegate-params");
  assertOwner(key, p.publicKey);
  const signedDelegate = await signDelegate(key, {
    senderId: p.senderId,
    receiverId: p.receiverId,
    nonce: BigInt(p.nonce),
    maxBlockHeight: BigInt(p.maxBlockHeight),
    actions,
  });
  return api("POST", "/console/relay", { signedDelegate });
}
