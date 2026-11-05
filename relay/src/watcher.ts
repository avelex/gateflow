// Polls 1Click for every recorded quote and submits `screen_intents` once the swap delivered into a payment.
import { submitScreening } from "./checkout.ts";
import type { Deps } from "./types.ts";

export const WATCH_INTERVAL_MS = 15_000;

export async function tick(deps: Deps): Promise<void> {
  for (const q of deps.db.openQuotes(deps.now())) {
    try {
      const status = String((await deps.oneclick.status(q.deposit_address))?.status ?? "UNKNOWN");
      if (status !== q.status) deps.db.markQuote(q.ref, { status, nowMs: deps.now() });
      if (status !== "SUCCESS") continue;
      const found = await deps.near.view(deps.cfg.gateflow, "get_payment_by_ref", { reference: q.ref });
      if (!found) continue; // delivery not on NEAR yet; next tick
      await submitScreening(deps, q.ref, found[0], q.deposit_address);
    } catch (e) {
      console.error(`watcher: quote ${q.ref}:`, (e as Error).message);
    }
  }
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
