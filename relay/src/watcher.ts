// Polls 1Click for every recorded quote and submits `screen_intents` once the swap delivered into a payment.
import { submitScreening } from "./checkout.ts";
import type { Quote } from "./db.ts";
import type { Deps } from "./types.ts";
import { deliver, watchApiInvoices } from "./webhooks.ts";

export const WATCH_INTERVAL_MS = 15_000;

/// Stores who sent the deposit, from 1Click's first origin tx; a failed read is retried on a later tick.
async function resolveSenders(deps: Deps, q: Quote, st: any): Promise<void> {
  const hash = st?.swapDetails?.originChainTxHashes?.[0]?.hash;
  if (!q.origin_chain || q.origin_senders !== null || typeof hash !== "string") return;
  try {
    deps.db.setOriginSenders(q.ref, (await deps.origin.senders(q.origin_chain, hash)) ?? []);
  } catch (e) {
    console.error(`watcher: senders of ${q.ref}:`, (e as Error).message);
  }
}

export async function tick(deps: Deps): Promise<void> {
  for (const q of deps.db.openQuotes(deps.now())) {
    try {
      const st = await deps.oneclick.status(q.deposit_address);
      const status = String(st?.status ?? "UNKNOWN");
      if (status !== q.status) deps.db.markQuote(q.ref, { status, nowMs: deps.now() });
      if (status !== "SUCCESS") continue;
      await resolveSenders(deps, q, st);
      if (q.screened) continue;
      const found = await deps.near.view(deps.cfg.gateflow, "get_payment_by_ref", { reference: q.ref });
      if (!found) continue; // delivery not on NEAR yet; next tick
      // Already screened or closed: `screen_intents` would only panic and burn relay gas every tick.
      if (found[1].status !== "Pending" || found[1].deposit_address) {
        deps.db.markQuote(q.ref, { status, screened: true });
        continue;
      }
      await submitScreening(deps, q.ref, found[0], q.deposit_address);
    } catch (e) {
      console.error(`watcher: quote ${q.ref}:`, (e as Error).message);
    }
  }
  await watchApiInvoices(deps);
  await deliver(deps);
}

export function startWatcher(deps: Deps): NodeJS.Timeout {
  let running = false;
  return setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await tick(deps);
    } finally {
      running = false;
    }
  }, WATCH_INTERVAL_MS);
}
