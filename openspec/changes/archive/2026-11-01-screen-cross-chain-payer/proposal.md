# Proposal

## Why

Payments from other chains reach Gateflow through NEAR Intents 1Click, so the tokens arrive by `ft_transfer_call` from the Intents side. The contract therefore screens the NEAR account that delivered them, never the origin-chain payer, and every such payment fails closed. Gateflow's promise, "screen the payer before the merchant is paid", must hold for payers on EVM chains, Bitcoin and Zcash.

## What Changes

- 1Click checkouts carry a random `ref` in `customRecipientMsg`, returned to the page with the deposit address.
- A payment with a `ref` opens as Pending without screening, and `ft_on_transfer` never panics on it: 1Click warns that funds are lost if it fails. A payment the deposit-time checks would reject is opened and refunded.
- New permissionless `screen_intents(payment, deposit_address)`: one screening per payment, paid from gateway fuel, submitted by the relay so the payer needs no NEAR.
- The enclave reads 1Click status for the deposit address and requires `SUCCESS`, recipient = Gateflow, the same gateway and `ref`, and a matching amount. It then resolves the origin senders and screens each:
  - EVM (Base, Ethereum, Arbitrum): tx `from`, screened by GoPlus.
  - Bitcoin: all input addresses, screened against the OFAC sanctioned-address list.
  - Zcash: transparent input addresses, screened against the OFAC list. Shielded senders fail closed.
- One gateway per received token: USDC for EVM payers, nBTC (`nbtc.bridge.near`) for BTC payers, ZEC (`zec.omft.near`) for ZEC payers. Merchants receive these tokens on NEAR.
- The relay builds the 1Click destination asset from the gateway token, accepts only EVM, BTC and ZEC origins, and requires `refundOnNear`.
- New relay route `POST /checkout/screen {depositAddress, ref}` submits `screen_intents` once 1Click reports `SUCCESS`.
- A failed settle or refund transfer (for example an account without storage on the token) leaves the payment retryable, not falsely closed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `payment-clearing`: `ref` payments open without screening and never reject at delivery; deferred screening binds the 1Click deposit and screens origin senders per chain; failed payout transfers can be retried.
- `checkout-relay`: quotes carry a `ref`, target the gateway token on NEAR, accept only screenable origins and require a NEAR refund account; new route triggers deferred screening.

## Impact

- `contract/`: `PayMsg` and `Payment` gain `ref` and deposit address; `screen_intents`; new `EnclaveRequest` variant; transfer-failure callback and retry. Fresh deployment (state layout changes); `storage_deposit` on each gateway token.
- `enclave/`: 1Click status client, EVM/BTC/ZEC sender resolvers, OFAC list screener. Secrets: `EVM_RPC_URLS`, optional `ONECLICK_API_KEY` (anonymous 1Click works with a higher fee).
- `relay/`: `ref`, destination mapping, origin allow-list, NEAR signer for `screen_intents`.
- Out of scope: shielded ZEC senders, taint analysis beyond address lists, refunds back to the origin chain, identity-gated cross-chain amounts.
