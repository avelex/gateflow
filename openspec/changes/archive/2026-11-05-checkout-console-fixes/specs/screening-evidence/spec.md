## ADDED Requirements

### Requirement: Screening and close times
The evidence SHALL carry `screenedAtSec`, the block time of the `outlayer.near` receipt that logged `execution_completed`, and `closedAtSec`, the block time of the Gateflow contract receipt that logged `payment_closed` for the payment, in UTC seconds. Each SHALL be null when the transaction holds no such receipt or the block time cannot be read.

#### Scenario: Settled payment
- **WHEN** payment 4's screening transaction has `execution_completed` in a block at 1793857840 and `payment_closed` for payment 4 in a block at 1793857841
- **THEN** the evidence has `screenedAtSec` 1793857840 and `closedAtSec` 1793857841

#### Scenario: Still pending
- **WHEN** the screening transaction holds `execution_requested` but no `execution_completed` yet
- **THEN** `screenedAtSec` and `closedAtSec` are null

#### Scenario: Spoofed close
- **WHEN** a receipt of an account other than the Gateflow contract logs `payment_closed`
- **THEN** its block time is not used

### Requirement: Stored evidence gains its times once
Stored evidence of a closed payment that has no `closedAtSec`, because it was stored before times existed, SHALL be read from the chain again once and stored with its times.

#### Scenario: Evidence stored before this change
- **WHEN** a Settled payment's stored evidence has no `closedAtSec` and the page asks for it
- **THEN** the backend reads the transaction once, stores the evidence with both times, and serves later requests from storage
