import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evidenceFor, findJob, opensPayment, outcome, type Parsed, parseEvidence } from "./screening.ts";
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

// ---------- OutLayer jobs ----------

const JOBS = JSON.parse(readFileSync(new URL("./fixtures/outlayer-jobs.json", import.meta.url), "utf8"));
const C8 = "C8UdBVpFo4kNQUU1tWivMeSKGkU3SYu5DNADuQCi35RS";
const job = (i: number) => ({ job_id: 1000 + i, request_id: i, transaction_hash: `t${i}` });

test("find_job_fixture", async () => {
  const d = fakeDeps();
  d.outlayer.jobList = JOBS;
  assert.equal(await findJob(d, { txHash: C8, signer: "relay.gateflow.near", requestId: 2796 }), 1255332);
  assert.deepEqual(d.outlayer.calls[0], { user: "relay.gateflow.near", project: "ops.gateflow.near/gateflow", limit: 50, offset: 0 });
});

test("find_job_request_mismatch", async () => {
  const d = fakeDeps();
  d.outlayer.jobList = JOBS;
  assert.equal(await findJob(d, { txHash: C8, signer: "relay.gateflow.near", requestId: 9999 }), null);
});

test("find_job_pages", async () => {
  const d = fakeDeps();
  d.outlayer.jobList = Array.from({ length: 160 }, (_, i) => job(i));
  assert.equal(await findJob(d, { txHash: "t120", signer: "s", requestId: 120 }), 1120);
  assert.equal(d.outlayer.calls.length, 3);
});

test("find_job_page_cap", async () => {
  const d = fakeDeps();
  d.outlayer.jobList = Array.from({ length: 300 }, (_, i) => job(i));
  assert.equal(await findJob(d, { txHash: "t250", signer: "s", requestId: 250 }), null);
  assert.equal(d.outlayer.calls.length, 4);
});

test("find_job_api_error", async () => {
  const d = fakeDeps();
  d.outlayer.fail = new Error("down");
  assert.equal(await findJob(d, { txHash: C8, signer: "s", requestId: 2796 }), null);
});

// withTx records payment 3 under signer gateflow.near with the 4e9W fixture (request 2792).
const jobFor = (txHash: string, requestId: number, jobId: number) => ({ job_id: jobId, request_id: requestId, transaction_hash: txHash });

test("job_id_stored", async () => {
  const d = withTx();
  d.outlayer.jobList = [jobFor("4e9W", 2792, 1255043)];
  assert.equal((await evidenceFor(d, 3, "Settled"))?.jobId, 1255043);
  assert.equal(JSON.parse(d.db.screening(3)!.evidence!).jobId, 1255043);
  d.clock.ms += 120_000;
  assert.equal((await evidenceFor(d, 3, "Settled"))?.jobId, 1255043);
  assert.equal(d.outlayer.calls.length, 1);
  assert.equal(d.outlayer.calls[0].user, "gateflow.near");
});

test("job_retry_throttled", async () => {
  const d = withTx();
  assert.equal((await evidenceFor(d, 3, "Settled"))?.jobId, null);
  d.outlayer.jobList = [jobFor("4e9W", 2792, 1255043)];
  d.clock.ms += 30_000;
  assert.equal((await evidenceFor(d, 3, "Settled"))?.jobId, null);
  assert.equal(d.outlayer.calls.length, 1);
  d.clock.ms += 31_000;
  assert.equal((await evidenceFor(d, 3, "Settled"))?.jobId, 1255043);
  assert.equal(JSON.parse(d.db.screening(3)!.evidence!).jobId, 1255043);
});

test("legacy_evidence_filled", async () => {
  const d = fakeDeps();
  d.db.recordScreening(0, C8, "relay.gateflow.near");
  d.db.storeEvidence(0, { txHash: C8, requestId: 2796, project: "p", wasmHash: "w", wasmUrl: null, timeMs: 1, costYocto: "1", outcome: "approved" });
  d.outlayer.jobList = JOBS;
  assert.equal((await evidenceFor(d, 0, "Settled"))?.jobId, 1255332);
  assert.equal(JSON.parse(d.db.screening(0)!.evidence!).jobId, 1255332);
});

// ---------- step times ----------

const SCREENED_BLOCK = "5sWEycTUyz7va7cDpV8eB5oXqzGGRwCmvNZVBGVsTV93";
const CLOSED_BLOCK = "4cHQX9kYBXDPsNR1NoPGweB3N3bVnnucdnp424KpSnLG";
const closedLog = (payment: number) => `EVENT_JSON:{"standard":"gateflow","version":"1.0.0","event":"payment_closed","data":[{"payment":${payment},"invoice":0,"status":"Settled"}]}`;
const withTimes = (closer = "gateflow.near") => {
  const d = fakeDeps({ outlayerContract: "outlayer.near", gateflow: "gateflow.near" });
  const t = tx();
  const r = t.receipts_outcome.find((x: any) => x.block_hash === CLOSED_BLOCK);
  r.outcome.executor_id = closer;
  r.outcome.logs.push(closedLog(3));
  d.near.txTable["4e9W"] = t;
  d.near.blocks = { [SCREENED_BLOCK]: 1793857840, [CLOSED_BLOCK]: 1793857841 };
  d.db.recordScreening(3, "4e9W", "gateflow.near");
  return d;
};

test("evidence_has_times", async () => {
  const s = await evidenceFor(withTimes(), 3, "Settled");
  assert.equal(s?.screenedAtSec, 1793857840);
  assert.equal(s?.closedAtSec, 1793857841);
});

test("spoofed_close_ignored", async () => {
  const s = await evidenceFor(withTimes("evil.near"), 3, "Settled");
  assert.equal(s?.screenedAtSec, 1793857840);
  assert.equal(s?.closedAtSec, null);
});

test("pending_has_no_times", async () => {
  const d = withTimes();
  const s = await evidenceFor(d, 3, "Pending");
  assert.equal(s?.screenedAtSec, null);
  assert.equal(s?.closedAtSec, null);
});

test("legacy_evidence_gets_times", async () => {
  const d = withTimes();
  d.db.storeEvidence(3, { txHash: "4e9W", requestId: 2792, project: "p", wasmHash: HASH, wasmUrl: null, timeMs: 1410, costYocto: "1", outcome: "approved", jobId: 7 });
  const s = await evidenceFor(d, 3, "Settled");
  assert.equal(s?.closedAtSec, 1793857841);
  assert.equal(s?.jobId, 7);
  assert.equal(s?.outcome, "approved");
  assert.equal(d.near.txCalls.length, 1);
  await evidenceFor(d, 3, "Settled");
  assert.equal(d.near.txCalls.length, 1);
});

test("legacy_evidence_tx_gone_kept", async () => {
  const d = withTimes();
  d.near.txTable = {};
  d.db.storeEvidence(3, { txHash: "4e9W", requestId: 2792, project: "p", wasmHash: HASH, wasmUrl: null, timeMs: 1410, costYocto: "1", outcome: "approved", jobId: 7 });
  const s = await evidenceFor(d, 3, "Settled");
  assert.equal(s?.outcome, "approved");
  assert.equal(s?.closedAtSec, null);
  await evidenceFor(d, 3, "Settled");
  assert.equal(d.near.txCalls.length, 1);
});
