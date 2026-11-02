// NEAR wallets for the direct payment (design decision 7). Loaded with import() from NearPay only.
import "./node-shims.ts";
import { actionCreators, setupWalletSelector } from "@near-wallet-selector/core";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupModal } from "@near-wallet-selector/modal-ui";
import "@near-wallet-selector/modal-ui/styles.css";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { type CheckoutInvoice, transferCallArgs } from "./logic.ts";

const network = (import.meta.env.VITE_NEAR_NETWORK ?? "testnet") as "testnet" | "mainnet";
let selector: ReturnType<typeof setupWalletSelector> | undefined;
const getSelector = () => (selector ??= setupWalletSelector({ network, modules: [setupMyNearWallet(), setupMeteorWallet()] }));

/// Opens the wallet picker if no wallet is connected, then sends the invoice's ft_transfer_call.
/// Redirect wallets leave the page here; the return is handled by `wasSent`.
export async function payDirect(inv: CheckoutInvoice): Promise<void> {
  const s = await getSelector();
  if (!s.isSignedIn()) {
    const modal = setupModal(s, {});
    await new Promise<void>((resolve, reject) => {
      const signedIn = s.on("signedIn", () => (signedIn.remove(), modal.hide(), resolve()));
      modal.on("onHide", ({ hideReason }) => hideReason === "user-triggered" && (signedIn.remove(), reject(new Error("Wallet was closed"))));
      modal.show();
    });
  }
  const a = transferCallArgs(inv);
  const wallet = await s.wallet();
  const outcome = await wallet.signAndSendTransaction({
    receiverId: a.receiverId,
    actions: [actionCreators.functionCall(a.method, a.args, BigInt(a.gas), BigInt(a.deposit))],
  });
  if (!outcome?.transaction?.hash) throw new Error("The wallet did not send the payment");
}
