# screening-evidence Specification

## Purpose

Records, for each payment, the NEAR transaction that ran its enclave screening and the OutLayer execution evidence read from that transaction, so the checkout and the console can show what ran and with what outcome.

## Requirements

### Requirement: Screening transaction per payment
The backend SHALL keep at most one screening transaction hash per payment. For a cross-chain payment it SHALL record the hash of the `screen_intents` transaction it submits. For a direct payment it SHALL record the hash reported by the checkout once verified. A recorded hash SHALL NOT be replaced.

#### Scenario: Cross-chain screening submitted
- **WHEN** the backend submits `screen_intents` for payment 4 and the transaction hash is `9xQ…`
- **THEN** payment 4's screening transaction is `9xQ…`

#### Scenario: Second report ignored
- **WHEN** payment 4 already has a screening transaction and another valid hash is reported for it
- **THEN** the recorded hash stays unchanged

### Requirement: Execution evidence from the transaction
The backend SHALL read the evidence only from the recorded transaction's `outlayer.near` receipts: the `execution_requested` event's `request_id` and project, and the `execution_completed` event's wasm hash, `time_ms`, `payment_charged` and `success`, plus the returned verdict. It SHALL ignore events from any other account or standard than `near-outlayer`.

#### Scenario: Approved run
- **WHEN** payment 4's screening transaction holds `execution_requested` with `request_id` 2792 and `execution_completed` with hash `11a4ef…`, `time_ms` 1410, `success` true, and the verdict `true`
- **THEN** the evidence is request id 2792, wasm hash `11a4ef…`, 1410 ms, the charged cost, and outcome `approved`

#### Scenario: Spoofed event
- **WHEN** the transaction holds an `execution_completed` event logged by an account other than `outlayer.near`
- **THEN** that event is not used as evidence

### Requirement: Outcome classification
The evidence outcome SHALL be `approved` or `rejected` only when OutLayer completed with a JSON verdict matching the payment's final status. It SHALL be `failed` when the OutLayer execution did not complete successfully, `no_verdict` when the payment closed without a completed execution, and `pending` while the payment is Pending.

#### Scenario: Execution failed
- **WHEN** payment 5 is Refunded and its `execution_completed` event has `success` false
- **THEN** the outcome is `failed`

#### Scenario: Reclaimed after the clearing window
- **WHEN** payment 6 was refunded through `reclaim` and its screening transaction has no completed execution
- **THEN** the outcome is `no_verdict`

### Requirement: Final evidence is stored
Once a payment is no longer Pending and its evidence is read, the backend SHALL store the evidence and serve it without reading the chain again. Pending evidence SHALL be read again on each request.

#### Scenario: Settled payment served from storage
- **WHEN** evidence for a Settled payment was stored and the page asks again
- **THEN** the backend returns the stored evidence without an RPC call

### Requirement: No evidence without a transaction
A payment with no recorded screening transaction SHALL have no evidence, and the backend SHALL NOT guess one.

#### Scenario: Direct payer closed the wallet tab
- **WHEN** a direct payment is Settled but the checkout never reported its transaction
- **THEN** the payment's evidence is null

### Requirement: OutLayer job of the screening
The evidence SHALL carry `jobId`: the OutLayer job whose `transaction_hash` equals the screening transaction and whose `request_id` equals the evidence's request id, read from OutLayer's jobs API for the transaction's signer and the configured project. It SHALL be null when no such job is found, and SHALL NOT be guessed from the request id.

#### Scenario: Job found
- **WHEN** payment 0's screening tx is `C8Ud…` with request id 2796, and OutLayer lists job 1255332 with that tx and request id under signer `relay.gateflow.near`
- **THEN** payment 0's evidence has `jobId` 1255332

#### Scenario: Request id mismatch
- **WHEN** OutLayer lists a job with the screening tx but a different request id
- **THEN** `jobId` stays null

#### Scenario: OutLayer API down
- **WHEN** the jobs API fails or times out
- **THEN** the evidence is returned with `jobId` null and the request does not fail

### Requirement: Job lookup is retried until found
A payment whose evidence has `jobId` null and a request id SHALL have its job looked up again on later reads, at most once per minute per payment, and the stored evidence SHALL be updated once the job is found. Evidence stored before `jobId` existed SHALL be treated as `jobId` null.

#### Scenario: Job appears later
- **WHEN** the first lookup for a Settled payment finds no job and OutLayer lists it two minutes later
- **THEN** a read after that returns and stores the `jobId`

#### Scenario: Throttled
- **WHEN** a checkout page polls a payment with `jobId` null every 5 seconds for one minute
- **THEN** the backend queries OutLayer's jobs API for that payment at most twice
