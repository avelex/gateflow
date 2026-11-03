# Spec Delta

## MODIFIED Requirements

### Requirement: Invoice screening details
The invoice's expandable Details section SHALL show a Screening block once the invoice has a payment: the flow (direct or cross-chain), the risk limit the payment was screened against, the deposit address for a cross-chain payment, the OutLayer project, and, when evidence exists, the outcome, request id, wasm hash, run time, cost in NEAR, and links to the NEAR explorer transaction and to OutLayer executions.

#### Scenario: Settled direct payment
- **WHEN** Kaja expands Details on a Paid invoice whose payment was screened as request 2792 by wasm `11a4ef…` in 1410 ms
- **THEN** the Screening block shows flow Direct, the risk limit, project `ops.gateflow.near/gateflow`, outcome Approved, request 2792, wasm `11a4ef…`, 1.4 s, the cost, and both links

#### Scenario: Request linked to its attestation
- **WHEN** the payment's evidence has `jobId` 1255332 and request id 2796
- **THEN** the request field shows 2796 and links to `https://app.outlayer.ai/attestation/1255332?network=mainnet` instead of OutLayer executions

#### Scenario: Returned without a verdict
- **WHEN** Kaja expands Details on a Returned invoice whose screening outcome is `no_verdict`
- **THEN** the Screening block says no verdict arrived within 15 minutes and shows no wasm hash as the screening code

#### Scenario: Evidence unavailable
- **WHEN** the invoice's payment has no recorded screening transaction
- **THEN** the Screening block shows flow, risk limit and project, and says the screening record is unavailable

#### Scenario: Collapsed by default
- **WHEN** Kaja opens an invoice without expanding Details
- **THEN** no wasm hash, request id or cost is visible
