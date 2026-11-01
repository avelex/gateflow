# Design

## Context

See proposal.md (Why). Requirements live in the main specs `payment-clearing`, `merchant-gateways` and `invoices`, plus this change's deltas. Constraints that shape the contract:

- A NEAR contract cannot see other chains or make HTTP calls. Origin chains, senders and screening belong to the OutLayer enclave. The contract only escrows NEP-141 tokens and applies the verdict.
- 1Click delivers to the contract with `ft_transfer_call` from `intents.near`. Funds are lost if that call fails, so the `ref` path never panics once the sender, token and invoice are known.
- The account will hold no full-access key after deployment. Nothing can be fixed in place, so the state layout and method set have to be right at the first deploy.

```
                 +------------------- gateflow (no access keys) -------------------+
 operator ------>| set_operator  add_token  remove_token  set_enclave              |
 owner   ------->| create_gateway$  set_policy  create_invoice                      |
 anyone  ------->| fund$  screen_intents  reclaim  retry                            |
 token   ------->| ft_on_transfer ---------------------------> OutLayer request_execution
                 | on_screened (private) <-------------------- verdict / error      |
                 | close ------------------------------------> token.ft_transfer    |
                 | on_closed (private)   <-------------------- result               |
                 +------------------------------------------------------------------+
```

## Goals / Non-Goals

**Goals:**
- Every behaviour in the specs, written from scratch in Rust near-sdk 5.
- No path from the operator to escrowed funds, and no code upgrade path.
- Every state change visible as a NEP-297 event, so the relay watcher needs no polling of views.

**Non-Goals:**
- State migration or versioned state: there is never a second code version on the same account.
- Storage deposits charged to merchants or payers.
- `get_gateways(owner)`: the console backend maps each merchant to a gateway id.

## Decisions

**1. State.** Sequential ids are vector indexes.

```
Gateflow {
  operator:   AccountId,
  relay:      AccountId,                      // only caller of screen_intents; set_relay by operator
  intents:    AccountId,                      // fixed at new(): intents.near on mainnet
  enclave:    { outlayer: AccountId, project: String, secrets_owner: AccountId },
  execution_deposit: NearToken,               // fixed at new()
  tokens:     IterableSet<AccountId>,
  gateways:   Vector<Gateway>,                // GatewayId = u32 index
  invoices:   Vector<Invoice>,                // InvoiceId = u64 index
  payments:   Vector<Payment>,                // PaymentId = u64 index
  refs:       LookupMap<String, PaymentId>,
  invoice_index: LookupMap<(GatewayId, u32), InvoiceId>,
  payment_index: LookupMap<(GatewayId, u32), PaymentId>,
}
Gateway { owner, payout_to, policy: { max_risk: u8 }, fuel: NearToken, invoices: u32, payments: u32 }
Invoice { gateway, token, amount: U128, expires_at_sec: u64, memo: Option<String>,
          status: Open | Paying | Paid | Returned, payment: Option<PaymentId> }
Payment { gateway, invoice, payer, refund_to, token, amount: U128, reference: Option<String>,
          deposit_address: Option<String>, opened_at_sec: u64, max_risk: u8,
          status: Pending | Settled | Refunded | SettleFailed | RefundFailed }
```

- `Payment.invoice` is not optional, because every payment names an invoice. A payment refunded at delivery records the invoice it named but never changes it (see decision 3).
- *Alternative:* `LookupMap` plus a counter per collection, as in the earlier contract. `Vector` gives the same storage cost with less code.

**2. Methods.**

| Caller | Method | Notes |
|---|---|---|
| init | `new(operator, relay, intents, enclave, execution_deposit)` | `#[init]`, once; `intents` is the only accepted `ref` sender (`intents.near` on mainnet, a test account on testnet, where `intents.near` does not exist) |
| operator | `set_operator`, `set_relay`, `add_token`, `remove_token`, `set_enclave(enclave)` | panic "not the operator" |
| anyone (becomes owner) | `create_gateway(payout_to, policy) -> GatewayId` | payable, deposit = fuel, at least one execution deposit |
| owner | `set_policy`, `create_invoice(...) -> InvoiceId` | panic "not the gateway owner"; invoice storage is drawn from fuel |
| anyone | `fund(gateway)` | payable |
| token | `ft_on_transfer(sender_id, amount, msg) -> U128` | always `U128(0)` when it does not panic |
| relay | `screen_intents(payment, deposit_address)` | panic "not the relay" |
| anyone | `reclaim(payment)`, `retry(payment)` | permissionless |
| self | `on_screened(payment)`, `on_closed(payment)` | `#[private]` callbacks |
| view | `get_operator`, `get_relay`, `get_tokens`, `get_gateway`, `get_invoice`, `get_invoices`, `get_payment`, `get_payment_by_ref`, `get_payments` | pages capped at 100 |

**3. `ft_on_transfer` order of checks.** The cheap checks come first and panic without writing state. The `ref` branch only reaches open-and-refund after the token, `msg`, invoice existence and sender are known good. This bounds storage growth to invoices plus paid-for 1Click deliveries.

```
token allowlisted?                 no -> panic "token not accepted"
msg parses, invoice exists?        no -> panic
ref?  sender_id == intents.near?   no -> panic "ref payments only from intents.near"
      dup ref | invoice check fail -> open(invoice untouched) + close(refund)
      else                         -> open Pending, invoice Paying
no ref: invoice check, fuel check  -> panic on failure
        else                       -> open Pending, invoice Paying, fuel -= deposit, screen
```

**4. Closing is the single exit for funds.** `close(id, approved)` is the only code that builds `ft_transfer`: to `gateway.payout_to` when approved, otherwise to `payment.refund_to`, always in `payment.token` with 1 yoctoNEAR. `on_screened`, `reclaim` and the `ref` refund at delivery all route through `close`. `retry` rebuilds the same transfer for a `*Failed` payment. This makes the "funds leave only to payout or refund" requirement checkable in one function.

**5. Pending is the guard against races.** `on_screened` and `reclaim` both act only while the payment is Pending. If `reclaim` refunds first, a late verdict is ignored, and so is the reverse. The invoice moves to Paid or Returned in `close`, at the same moment the payment's status is set.

**6. Execution deposit and fuel.** The deposit is attached to the OutLayer call. If that call fails, NEAR refunds the attached deposit to the contract, and `on_screened` adds it back to the gateway's fuel when the promise result is an error. A verdict of `false` does not refund the fuel, because the execution ran.

**7. Gas.** `on_screened` reserves 40 Tgas, enough to schedule `ft_transfer` (10 Tgas) plus `on_closed` (10 Tgas). `screen_intents` and `ft_on_transfer` attach the remaining gas to the OutLayer call. The relay calls `screen_intents` with 300 Tgas.

**8. Events.** One helper emits `EVENT_JSON:` with `standard: "gateflow"` and `version: "1.0.0"`. The event names and fields are in the `Contract events` requirement.

**9. Deployment removes the key.** Deploy and `new()` in one batch transaction, then delete the account's full-access key. `storage_deposit` for `gateflow` on each token is paid by the operator from its own account; the token contracts allow anyone to register another account. The contract balance pays for storage and can be topped up by any plain transfer.

**10. OutLayer call shape** (spike 1.1, docs at app.outlayer.ai/docs/near-integration, /dev-guide, /pricing, 2026-11-01).
- Call `request_execution` on `enclave.outlayer` with deposit `execution_deposit` and 100 Tgas, then `.then(on_screened(payment))` with `SCREENED_CALLBACK_GAS`. Args:
  `{"source":{"Project":{"project_id":<enclave.project>,"version_key":null}},"resource_limits":{},"input_data":<request JSON as a string>,"secrets_ref":{"profile":"default","account_id":<enclave.secrets_owner>},"response_format":"Json","payer_account_id":<this contract>}`.
- `resource_limits` must be present even when empty; `{}` takes the defaults (60 s).
- `payer_account_id` is the contract itself, so unused deposit returns to the contract balance, not to the transaction signer.
- Verdict: approve only on `PromiseResult::Successful(bytes)` where `serde_json::from_slice::<bool>(bytes) == Ok(true)`. Any other success payload refunds. The docs do not pin the exact bytes, so an unexpected wrapper fails closed.
- Failure: the docs conflict on whether a failed execution refunds its deposit ("charged for the resources it used" vs "failed executions are not refunded"). On `PromiseResult::Failed` the contract credits one `execution_deposit` back to the gateway's fuel from its own balance, as the spec requires; any OutLayer refund lands in the contract balance through `payer_account_id`.
- Timeout: OutLayer bounds a run by `max_execution_seconds`. A callback that never arrives is covered by `reclaim` after 15 minutes.
- `secrets_ref` needs the secrets owner's account, so the enclave setting is `{outlayer, project, secrets_owner}`.
- `ref` sender: when 1Click delivers with `customRecipientMsg`, `intents.near` withdraws with a non-null `msg`, which the Verifier sends as `ft_transfer_call` with no refund on failure (docs.near-intents.org, withdrawals). Under NEP-141 the receiver's `ft_on_transfer` gets `sender_id` = the caller of `ft_transfer_call`, which is `intents.near`. `mainnet-launch` 2.1 records a live delivery to confirm it.

**11. Only the relay calls `screen_intents`** (final review, 2026-11-01). The first call fixes the deposit address, and a wrong one makes the enclave return false and refund. A permissionless call let anyone watching the chain refund every cross-chain payment.
- The operator sets `relay` at `new()` and can change it with `set_relay`.
- The relay can still only delay. The verdict comes from the enclave, and `reclaim` covers a relay that never calls.
- *Rejected:* a re-screen after a binding failure. The enclave would need a third result, and every griefing attempt would burn gateway fuel that the operator tops up.

**12. Merchants pay for their own storage** (final review, 2026-11-01). Anyone can create a gateway, so "only onboarded merchants invoice" is not a bound.
- `create_gateway` requires at least one execution deposit, which is more than a gateway's own storage.
- `create_invoice` first requires fuel for an upper bound of 512 bytes (memo ≤ 140 B, token ≤ 64 B, index entry, record overheads), failing with "gateway has no fuel for invoice storage". It then flushes the invoice and index collections, measures `env::storage_usage()` before and after, and deducts `bytes * env::storage_byte_cost()` from fuel (about 146 bytes, 0.0015 NEAR, for a memo-less invoice). Checking the bound before writing keeps the failure path free of writes. The relay's existing top-up keeps onboarded merchants' fuel above the target, so they never see this.
- Payment records stay on the contract balance: each accepted payment needs an invoice, and a `ref` refund needs a paid 1Click delivery.
- *Rejected:* operator-approved gateway owners, which adds an onboarding step and makes the operator a gatekeeper.

## Risks / Trade-offs

- [A bug in the deployed contract cannot be patched] → Pending payments live at most 15 minutes, so a new contract can replace it: stop quoting, wait for `reclaim`, point the relay at the new account. `SettleFailed` and `RefundFailed` payments stay retryable on the old contract.
- [A lost operator key freezes the allowlist and the enclave setting] → payments keep working. Keep the operator key in a multisig or cold storage, and rotate it with `set_operator`.
- [Contract balance runs out of storage] → storage per invoice and per payment is about 200–300 bytes. The operator watches the balance; a plain transfer tops it up.
- [`intents.near` is the only accepted `ref` sender] → if 1Click starts delivering from another account, `ref` payments panic and 1Click loses funds. Mitigation: the relay's quote test (mainnet-launch 2.1) checks the real `sender_id`. A changed sender needs a new contract.
- [The relay is down or its key is lost] → `ref` payments refund through `reclaim` after 15 minutes; the operator points `set_relay` at a new account.
- [A malicious enclave set by the operator] → it can approve flagged payers or refund clean ones, but it cannot redirect funds (decision 4).

## Migration Plan

1. Build the release wasm. Deploy to a fresh account with `new(...)` in one transaction.
2. As operator: `add_token` for USDC, `nbtc.bridge.near` and `zec.omft.near`, then `storage_deposit` `gateflow` on each token.
3. Delete the account's full-access key. Verify that `view_access_key_list` returns no keys.
4. Point the relay's `GATEFLOW_CONTRACT` and the enclave build at the new account.
5. Rollback: the relay points back at the previous contract. Nothing on the new account needs undoing.
