import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDeps, type TestDeps } from "./testing.ts";
import { tick } from "./watcher.ts";

const REF = "0123456789abcdef0123456789abcdef";
const REF2 = "fedcba9876543210fedcba9876543210";

function quote(deps: TestDeps, ref = REF, dep = "dep1") {
  deps.db.insertQuote({ ref, invoice: 7, deposit_address: dep, deadline_ms: deps.now() + 60_000 });
  deps.near.viewTable["gateflow.testnet.get_payment_by_ref"] = ({ reference }: any) => (reference === REF || reference === REF2 ? [4, { status: "Pending" }] : null);
}

test("watcher_screens_on_success", async () => {
  const deps = fakeDeps();
  quote(deps);
  deps.oneclick.statuses.dep1 = { status: "SUCCESS" };
  await tick(deps);
  assert.equal((deps.near.sent[0].actions[0] as any).functionCall.method, "screen_intents");
  assert.equal(deps.db.quoteByRef(REF)?.screened, 1);
  assert.equal(deps.db.screening(4)?.tx_hash, "h1");
  await tick(deps);
  assert.equal(deps.near.sent.length, 1);
});

test("watcher_already_started_counts_as_screened", async () => {
  const deps = fakeDeps();
  quote(deps);
  deps.oneclick.statuses.dep1 = { status: "SUCCESS" };
  deps.near.sendResults.push(() => ({ hash: "h", error: "screening already started" }));
  await tick(deps);
  assert.equal(deps.db.quoteByRef(REF)?.screened, 1);
  assert.equal(deps.db.screening(4), undefined);
});

test("watcher_waits_for_payment", async () => {
  const deps = fakeDeps();
  quote(deps);
  deps.near.viewTable["gateflow.testnet.get_payment_by_ref"] = () => null;
  deps.oneclick.statuses.dep1 = { status: "SUCCESS" };
  await tick(deps);
  assert.equal(deps.near.sent.length, 0);
  assert.equal(deps.db.openQuotes(deps.now()).length, 1);
});

test("watcher_stops_on_refunded", async () => {
  const deps = fakeDeps();
  quote(deps);
  deps.oneclick.statuses.dep1 = { status: "REFUNDED" };
  await tick(deps);
  assert.equal(deps.near.sent.length, 0);
  assert.equal(deps.db.openQuotes(deps.now()).length, 0);
});

test("watcher_stops_after_deadline", async () => {
  const deps = fakeDeps();
  quote(deps);
  deps.clock.ms += 60_000 + 3_600_001;
  await tick(deps);
  assert.deepEqual(deps.oneclick.calls, []);
});

test("watcher_isolates_failures", async () => {
  const deps = fakeDeps();
  quote(deps, REF, "dep1");
  quote(deps, REF2, "dep2");
  deps.oneclick.statuses.dep1 = new Error("1Click 500");
  deps.oneclick.statuses.dep2 = { status: "SUCCESS" };
  await tick(deps);
  assert.equal(deps.near.sent.length, 1);
  assert.equal(deps.db.quoteByRef(REF2)?.screened, 1);
  assert.equal(deps.db.quoteByRef(REF)?.screened, 0);
});
