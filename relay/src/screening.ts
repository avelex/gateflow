// Screening evidence: what OutLayer logged in the tx that ran a payment's screening (design decisions 1, 2, 5).
import type { Deps } from "./types.ts";

export type Outcome = "pending" | "approved" | "rejected" | "failed" | "no_verdict";

/// What the tx's `outlayer.near` receipts say about the execution; null where the tx says nothing.
export type Parsed = {
  requestId: number | null;
  project: string | null;
  wasmHash: string | null;
  wasmUrl: string | null;
  timeMs: number | null;
  costYocto: string | null;
  success: boolean | null;
  verdict: boolean | null;
};

export type Screening = Omit<Parsed, "success" | "verdict"> & { txHash: string; outcome: Outcome };

type Event = { standard?: string; version?: string; event?: string; data?: any[] };

/// NEP-297 events logged by `executor`'s receipts in standard `standard` v1.0.0, with the receipt that logged each.
function events(tx: any, executor: string, standard: string): { e: Event; receipt: any }[] {
  const out: { e: Event; receipt: any }[] = [];
  for (const r of tx?.receipts_outcome ?? []) {
    if (r?.outcome?.executor_id !== executor) continue;
    for (const log of r.outcome.logs ?? []) {
      if (typeof log !== "string" || !log.startsWith("EVENT_JSON:")) continue;
      try {
        const e: Event = JSON.parse(log.slice("EVENT_JSON:".length));
        if (e.standard === standard && e.version === "1.0.0") out.push({ e, receipt: r });
      } catch {
        // not an event
      }
    }
  }
  return out;
}

const str = (x: unknown) => (typeof x === "string" ? x : null);
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);

export function parseEvidence(tx: any, outlayer: string): Parsed {
  const evs = events(tx, outlayer, "near-outlayer");
  const requested = evs.find((x) => x.e.event === "execution_requested")?.e.data?.[0];
  const completed = evs.find((x) => x.e.event === "execution_completed");
  let request: any = {};
  try {
    request = typeof requested?.request_data === "string" ? JSON.parse(requested.request_data) : (requested?.request_data ?? {});
  } catch {
    // malformed request_data: no request fields
  }
  const c = completed?.e.data?.[0] ?? {};
  const wasm = c.code_source?.WasmUrl ?? request.code_source?.WasmUrl ?? {};
  const failedReceipt = (tx?.receipts_outcome ?? []).some((r: any) => r?.outcome?.executor_id === outlayer && r.outcome.status?.Failure);
  let verdict: boolean | null = null;
  const b64 = completed?.receipt.outcome.status?.SuccessValue;
  if (typeof b64 === "string") {
    try {
      const v = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
      if (typeof v === "boolean") verdict = v;
    } catch {
      // not a JSON verdict
    }
  }
  return {
    requestId: num(request.request_id),
    project: str(request.project_id),
    wasmHash: str(wasm.hash),
    wasmUrl: str(wasm.url),
    timeMs: num(c.resources_used?.time_ms),
    costYocto: str(c.payment_charged),
    success: failedReceipt ? false : typeof c.success === "boolean" ? c.success : null,
    verdict,
  };
}

/// Design decision 5: approved/rejected only when a completed run's verdict matches the final status.
export function outcome(status: string, p: Parsed): Outcome {
  if (status === "Pending") return "pending";
  if (p.success === false) return "failed";
  const settled = status === "Settled" || status === "SettleFailed";
  const refunded = status === "Refunded" || status === "RefundFailed";
  if (p.success && p.verdict === true && settled) return "approved";
  if (p.success && p.verdict === false && refunded) return "rejected";
  return "no_verdict";
}

/// Whether the Gateflow contract's own receipt in `tx` logged `payment_opened` for `payment`.
export function opensPayment(tx: any, gateflow: string, payment: number): boolean {
  return events(tx, gateflow, "gateflow").some((x) => x.e.event === "payment_opened" && x.e.data?.some((d) => d?.payment === payment));
}

/// A payment's evidence: stored once final, read from its recorded tx otherwise; null without a recorded tx.
export async function evidenceFor(deps: Deps, payment: number, status: string): Promise<Screening | null> {
  const row = deps.db.screening(payment);
  if (!row) return null;
  if (row.evidence) return JSON.parse(row.evidence);
  const tx = await deps.near.tx(row.tx_hash, row.sender);
  const { success, verdict, ...p } = parseEvidence(tx, deps.cfg.outlayerContract);
  // An unknown tx is not final yet: report it, store nothing.
  const s: Screening = { txHash: row.tx_hash, ...p, outcome: !tx && status !== "Pending" ? "no_verdict" : outcome(status, { ...p, success, verdict }) };
  if (tx && status !== "Pending") deps.db.storeEvidence(payment, s);
  return s;
}

const ACTIVE_TTL_MS = 60_000;
const active = new WeakMap<Deps, { value: string | null; at: number }>();

/// The OutLayer project's active wasm hash, read at most once per minute; null when OutLayer cannot be read.
export async function activeVersion(deps: Deps): Promise<string | null> {
  const hit = active.get(deps);
  if (hit && deps.now() - hit.at < ACTIVE_TTL_MS) return hit.value;
  let value: string | null = null;
  try {
    const p = await deps.near.view(deps.cfg.outlayerContract, "get_project", { project_id: deps.cfg.outlayerProject });
    value = typeof p?.active_version === "string" ? p.active_version : null;
  } catch {
    // OutLayer unreachable: the invoice still loads
  }
  active.set(deps, { value, at: deps.now() });
  return value;
}

const JOBS_PAGE = 50;
// ponytail: 4 pages (200 newest jobs per signer); raise it, or ask OutLayer for a tx filter, if lookups start missing.
const JOBS_PAGES = 4;

/// The OutLayer job that ran this tx's execution `requestId`, from the jobs of the tx signer; null when not listed or on error.
export async function findJob(deps: Deps, q: { txHash: string; signer: string; requestId: number }): Promise<number | null> {
  try {
    for (let page = 0; page < JOBS_PAGES; page++) {
      const jobs = await deps.outlayer.jobs({ user: q.signer, project: deps.cfg.outlayerProject, limit: JOBS_PAGE, offset: page * JOBS_PAGE });
      const hit = jobs.find((j) => j?.transaction_hash === q.txHash && j?.request_id === q.requestId);
      if (hit && Number.isSafeInteger(hit.job_id)) return hit.job_id;
      if (jobs.length < JOBS_PAGE) return null;
    }
  } catch {
    // OutLayer unreachable or changed: no link
  }
  return null;
}
