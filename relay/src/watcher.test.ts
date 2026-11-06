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

test("watcher_skips_payment_already_screened_or_closed", async () => {
  for (const p of [{ status: "Settled" }, { status: "Pending", deposit_address: "dep1" }]) {
    const deps = fakeDeps();
    quote(deps);
    deps.near.viewTable["gateflow.testnet.get_payment_by_ref"] = () => [4, p];
    deps.oneclick.statuses.dep1 = { status: "SUCCESS" };
    await tick(deps);
    assert.equal(deps.near.sent.length, 0);
    assert.equal(deps.db.quoteByRef(REF)?.screened, 1);
  }
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

test("watcher_records_deposit_seen", async () => {
  const deps = fakeDeps();
  let now = 1000;
  deps.now = () => now;
  quote(deps);
  deps.oneclick.statuses.dep1 = { status: "PENDING_DEPOSIT" };
  await tick(deps);
  assert.equal(deps.db.quoteByRef(REF)?.deposit_seen_ms, null);
  now = 16000;
  deps.oneclick.statuses.dep1 = { status: "PROCESSING" };
  await tick(deps);
  now = 31000;
  deps.oneclick.statuses.dep1 = { status: "SUCCESS" };
  await tick(deps);
  assert.equal(deps.db.quoteByRef(REF)?.deposit_seen_ms, 16000);
});

const ARB_TX = "0xe16b";
const success = { status: "SUCCESS", swapDetails: { originChainTxHashes: [{ hash: ARB_TX }] } };
function arbQuote(deps: TestDeps) {
  deps.db.insertQuote({ ref: REF, invoice: 7, deposit_address: "dep1", deadline_ms: deps.now() + 60_000, origin_chain: "arb" });
  deps.near.viewTable["gateflow.testnet.get_payment_by_ref"] = ({ reference }: any) => (reference === REF ? [4, { status: "Pending" }] : null);
  deps.oneclick.statuses.dep1 = success;
}

test("watcher_stores_sender", async () => {
  const deps = fakeDeps();
  arbQuote(deps);
  deps.origin.table[`arb:${ARB_TX}`] = ["0x200f"];
  await tick(deps);
  assert.equal(deps.db.quoteByRef(REF)?.origin_senders, '["0x200f"]');
  assert.equal(deps.db.quoteByRef(REF)?.screened, 1);
  await tick(deps);
  assert.deepEqual(deps.origin.calls, [`arb:${ARB_TX}`]);
});

test("watcher_sender_failure_still_screens", async () => {
  const deps = fakeDeps();
  arbQuote(deps);
  deps.origin.fail = new Error("403");
  await tick(deps);
  assert.equal(deps.db.quoteByRef(REF)?.screened, 1);
  assert.equal(deps.db.quoteByRef(REF)?.origin_senders, null);
  assert.equal(deps.near.sent.length, 1);
});

test("watcher_retries_sender_after_screened", async () => {
  const deps = fakeDeps();
  arbQuote(deps);
  deps.origin.fail = new Error("403");
  await tick(deps);
  deps.origin.fail = undefined;
  deps.origin.table[`arb:${ARB_TX}`] = ["0x200f"];
  await tick(deps);
  assert.equal(deps.db.quoteByRef(REF)?.origin_senders, '["0x200f"]');
  assert.equal(deps.near.sent.length, 1);
});

test("watcher_drops_resolved_screened_quote", async () => {
  const deps = fakeDeps();
  arbQuote(deps);
  deps.origin.table[`arb:${ARB_TX}`] = ["0x200f"];
  await tick(deps);
  assert.deepEqual(deps.db.openQuotes(deps.now()), []);
});

test("watcher_shielded_sender_stops", async () => {
  const deps = fakeDeps();
  arbQuote(deps);
  await tick(deps);
  assert.equal(deps.db.quoteByRef(REF)?.origin_senders, "[]");
  assert.deepEqual(deps.db.openQuotes(deps.now()), []);
});
