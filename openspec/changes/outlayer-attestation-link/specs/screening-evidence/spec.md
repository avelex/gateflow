# Spec Delta

## ADDED Requirements

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
