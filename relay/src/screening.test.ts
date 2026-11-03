import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evidenceFor, opensPayment, outcome, type Parsed, parseEvidence } from "./screening.ts";
import { fakeDeps } from "./testing.ts";

const TX = JSON.parse(readFileSync(new URL("./fixtures/outlayer-tx-approved.json", import.meta.url), "utf8"));
const HASH = "11a4efa612d4c52ecad82827035968f34f7bc840d2b1fea28a70715f2ee6dabe";
const tx = () => structuredClone(TX);
const completedReceipt = (t: any) => t.receipts_outcome.find((r: any) => r.outcome.logs.some((l: string) => l.includes("execution_completed")));
const NULLS: Parsed = { requestId: null, project: null, wasmHash: null, wasmUrl: null, timeMs: null, costYocto: null, success: null, verdict: null };

test("approved_fixture", () => {
  const p = parseEvidence(tx(), "outlayer.near");
  assert.equal(p.requestId, 2792);
  assert.equal(p.project, "ops.gateflow.near/gateflow");
  assert.equal(p.wasmHash, HASH);
  assert.equal(p.timeMs, 1410);
  assert.equal(p.costYocto, "1141000000000000000000");
  assert.equal(p.success, true);
  assert.equal(p.verdict, true);
});

test("spoofed_executor_ignored", () => {
  const t = tx();
  completedReceipt(t).outcome.executor_id = "evil.near";
  const p = parseEvidence(t, "outlayer.near");
  assert.equal(p.verdict, null);
  assert.equal(p.timeMs, null);
  assert.equal(p.success, null);
});

test("other_standard_ignored", () => {
  const t = tx();
  const r = completedReceipt(t);
  r.outcome.logs = r.outcome.logs.map((l: string) => l.replace('"standard":"near-outlayer"', '"standard":"fake"'));
  const p = parseEvidence(t, "outlayer.near");
  assert.equal(p.verdict, null);
  assert.equal(p.timeMs, null);
});

test("failed_completion", () => {
  const t = tx();
  const r = completedReceipt(t);
  r.outcome.logs = r.outcome.logs.map((l: string) => l.replace('"success":true', '"success":false').replace('"error_message":null', '"error_message":"timeout"'));
  assert.equal(parseEvidence(t, "outlayer.near").success, false);
});

test("failed_receipt", () => {
  const t = tx();
  completedReceipt(t).outcome.status = { Failure: { ActionError: {} } };
  assert.equal(parseEvidence(t, "outlayer.near").success, false);
});

test("no_outlayer_receipts", () => {
  assert.deepEqual(parseEvidence({ receipts_outcome: [] }, "outlayer.near"), NULLS);
});

const done: Parsed = { ...NULLS, success: true };

test("outcome_rules", () => {
  assert.equal(outcome("Pending", { ...done, verdict: true }), "pending");
  assert.equal(outcome("Settled", { ...done, verdict: true }), "approved");
  assert.equal(outcome("SettleFailed", { ...done, verdict: true }), "approved");
  assert.equal(outcome("Refunded", { ...done, verdict: false }), "rejected");
  assert.equal(outcome("Refunded", { ...NULLS, success: false }), "failed");
});

test("late_true_after_reclaim", () => assert.equal(outcome("Refunded", { ...done, verdict: true }), "no_verdict"));
test("reclaim_no_completion", () => assert.equal(outcome("Refunded", NULLS), "no_verdict"));

const opened = (executor: string, payment: number) => ({
  receipts_outcome: [
    {
      outcome: {
        executor_id: executor,
        logs: [`EVENT_JSON:{"standard":"gateflow","version":"1.0.0","event":"payment_opened","data":[{"payment":${payment},"invoice":7,"gateway":0}]}`],
        status: { SuccessValue: "" },
      },
    },
  ],
});

test("opens_payment", () => {
  assert.equal(opensPayment(opened("gateflow.near", 3), "gateflow.near", 3), true);
  assert.equal(opensPayment(opened("gateflow.near", 3), "gateflow.near", 4), false);
  assert.equal(opensPayment(opened("evil.near", 3), "gateflow.near", 3), false);
});

// ---------- storage ----------

test("record_first_wins", () => {
  const d = fakeDeps();
  d.db.recordScreening(4, "first", "op.testnet");
  d.db.recordScreening(4, "second", "op.testnet");
  assert.equal(d.db.screening(4)?.tx_hash, "first");
});

const withTx = () => {
  const d = fakeDeps({ outlayerContract: "outlayer.near" });
  d.db.recordScreening(3, "4e9W", "gateflow.near");
  d.near.txTable["4e9W"] = tx();
  return d;
};

test("settled_stores_once", async () => {
  const d = withTx();
  const s = await evidenceFor(d, 3, "Settled");
  assert.equal(s?.outcome, "approved");
  assert.equal(s?.requestId, 2792);
  assert.equal(s?.txHash, "4e9W");
  assert.deepEqual(await evidenceFor(d, 3, "Settled"), s);
  assert.equal(d.near.txCalls.length, 1);
});

test("stored_no_rpc", async () => {
  const d = withTx();
  await evidenceFor(d, 3, "Settled");
  d.near.txTable = {};
  assert.equal((await evidenceFor(d, 3, "Settled"))?.wasmHash, HASH);
});

test("pending_not_stored", async () => {
  const d = withTx();
  assert.equal((await evidenceFor(d, 3, "Pending"))?.outcome, "pending");
  assert.equal(d.db.screening(3)?.evidence, null);
});

test("unknown_tx_not_stored", async () => {
  const d = withTx();
  d.near.txTable = {};
  const s = await evidenceFor(d, 3, "Refunded");
  assert.equal(s?.outcome, "no_verdict");
  assert.equal(s?.wasmHash, null);
  assert.equal(d.db.screening(3)?.evidence, null);
});

test("no_row_null", async () => assert.equal(await evidenceFor(fakeDeps(), 9, "Settled"), null));
