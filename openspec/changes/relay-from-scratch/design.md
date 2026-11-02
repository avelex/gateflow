# Design

## Context

See proposal.md, "Why". Requirements: `checkout-relay`, `sponsored-transactions` and `merchant-accounts` (backend parts), plus this change's deltas.

**Contract interface** (`contract/src/*.rs`, not deployed anywhere yet):
- Writes:
  - `create_gateway(payout_to, policy)`, payable
  - `create_invoice(gateway, token, amount: U128, expires_in_sec, memo?)`
  - `set_policy`
  - `fund(gateway)`, payable
  - `retry(payment)`, permissionless
  - `screen_intents(payment, deposit_address)`, relay only
- Views:
  - `get_gateway`, which includes the `invoices` and `payments` counts
  - `get_invoice` and `get_invoices(gateway, from_index, limit ≤ 100)`
  - `get_payment`, `get_payment_by_ref(reference)` and `get_payments(gateway, from_index, limit)`
  - `get_tokens`, `get_relay` and `get_operator`
- Invoice storage is drawn from fuel, so a gateway needs fuel before its first invoice.
- `ft_transfer_call` `msg` is `{"invoice", "ref"?, "refund_to"?}`. Unknown keys are ignored.

**Prior art:** the archived `web-console-checkout` (decisions 1 and 4–9, tasks 3.1–4.4 and 6.1) and `screen-cross-chain-payer` (tasks 5.1–5.3) describe this relay down to function names. Their code is not in this repository. This design keeps their names where they still fit.

**Runtime:** Node 26.0.0, with `node:sqlite`, ed25519 in `node:crypto`, and TypeScript run directly. Only erasable TypeScript syntax is allowed: no `enum`, no parameter properties, no namespaces.

## Goals / Non-Goals

**Goals:**
- One process that holds the operator key, serves the API, runs the watcher and serves `web/dist`.
- Every route and the watcher can be tested with `node --test` and no network.

**Non-Goals:**
- Horizontal scaling, rate limiting, email verification, and a NEAR or HTTP framework dependency.
- Verifying the merchant's delegate signature in the relay. The chain verifies it, and the relay only enforces the allowlist.

## Decisions

**1. Layout and dependency injection.**

```
relay/src/
  main.ts      env -> Config, real Deps, node:http server, route table, setInterval(watcher)
  near.ts      base58, borsh, actions, signing, RPC client (implements Near)
  delegate.ts  decodeSignedDelegate, refusal
  db.ts        openDb(path) -> prepared helpers
  console.ts   /console/* handlers, slug, needsTopUp
  checkout.ts  /checkout/* handlers, destinationAsset, originChain, screenable, quoteRequest
  watcher.ts   tick(deps)
  static.ts    serveStatic(dir, pathname)
```

- A handler is `(req: Req, deps: Deps) => Promise<Res>`.
  - `Req = {method, path, query, body, cookies}`.
  - `Res = {status, json?, headers?}`.
- `Deps = {cfg, db, near, oneclick, now}`, where:
  - `near` has `view`, `send(receiver, actions)`, `accountExists`, `accessKey`, `head`;
  - `oneclick` has `tokens`, `quote`, `status`.
- `main.ts` builds the real `Deps`. Tests build fakes over a `":memory:"` DB.
- `HttpError(status, message)` becomes `{error}`. `/checkout/*` replies carry `Access-Control-Allow-Origin: *`, and `/console/*` is same-origin.
- *Rejected:* a module-level singleton client, because it cannot be tested without monkeypatching.

**2. NEAR signing (`near.ts`).**
- Base58 and Borsh are hand-written.
- Action tags: CreateAccount 0, FunctionCall 2, Transfer 3, AddKey 5 (full access), Delegate 8.
- The `RELAY_PRIVATE_KEY` seed (`ed25519:<base58 64 bytes>`) is wrapped with the PKCS#8 prefix `302e020100300506032b657004220420` and signed with `node:crypto`.
- `send_tx` uses `wait_until: "FINAL"`. `TxResult = {hash, value?, error?}`:
  - `value` is the base64 JSON `SuccessValue` of the receipt executed by `GATEFLOW_CONTRACT`;
  - `error` is the `ExecutionError` text with the `Smart contract panicked: ` prefix removed.
- **Nonce:** all operator sends go through one in-process promise queue. The access-key nonce is re-read once per send, inside the queue.
- *Rejected:* `near-api-js`, because of the no-dependency rule. The same Borsh code also decodes delegates.

**3. Delegate relaying.**
- `decodeSignedDelegate(b64)` returns `{senderId, receiverId, actions, nonce, maxBlockHeight, publicKey}`.
- `refusal(action, sessionAccount, gateflow)` returns a reason, or `undefined`. It passes only when:
  - the sender is `sessionAccount`;
  - the receiver is `gateflow`;
  - there is at least one action, and every action is a FunctionCall to `create_gateway`, `create_invoice` or `set_policy` with deposit 0 and gas ≤ 100 Tgas.
- The relay sends `[{signedDelegate}]` to the sender's account, from the operator.
- `GET /console/delegate-params` returns:
  - `nonce`: the merchant key's access-key nonce + 1;
  - `maxBlockHeight`: head + 120;
  - `publicKey`: the stored key.
- **Gateway step:** when a relayed `create_gateway` returns a gateway id, the relay:
  1. stores it;
  2. calls `fund(gateway)` with `FUEL_TARGET` attached, because a new gateway's fuel is 0 under the delta;
  3. sets `step = done`, all in the same request.

**4. Provisioning.**
- `POST /console/onboard {name, publicKey, payoutTo?}` advances `step`: `account` → `tokens` → `gateway` → `done`. It resumes from the stored step.
- **account:**
  - `slug(name)`: lowercase, runs of non-`[a-z0-9]` become `-`, trimmed of `-`, at most 32 characters, and `merchant` when empty;
  - while `accountExists`, add the suffix `-2`, `-3` and so on;
  - one transaction to `<slug>.<RELAY_ACCOUNT_ID>`: CreateAccount, Transfer 0.01 NEAR, AddKey(merchant pk, FullAccess).
- **tokens:** `storage_deposit({account_id, registration_only: true})` on every `get_tokens` token, attaching `storage_balance_bounds.min`.
- Also:
  - a different `publicKey` for an existing account answers 409;
  - `MAX_MERCHANTS` is checked before `account`;
  - each email has an in-process lock.

**5. Database (`db.ts`, `node:sqlite`).**
- `merchants(email PK, name, account_id UNIQUE, public_key, gateway_id, step, tokens_off TEXT JSON DEFAULT '[]')`
- `sessions(token PK, email, created_at)`
- `quotes(ref PK, invoice, deposit_address UNIQUE, deadline_ms, status, screened INTEGER DEFAULT 0)`
- Prepared statements only, with no ORM. Amounts never go into the DB; they live on-chain.

**6. Sessions.**
- `POST /console/session {email}`: the email must match `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` and is lowercased.
- The cookie is `gateflow_session=<32-byte hex>`, with `HttpOnly; SameSite=Lax; Path=/`, plus `Secure` when `PUBLIC_URL` is `https:`.
- `GET /console/me` answers 401 without a session.
- `DELETE /console/session` deletes the row.

**7. Console data.**
- **Gateway:** `GET /console/gateway` tops up first when `needsTopUp(fuel, deposit) = fuel < 2 × deposit`. The top-up attaches `FUEL_TARGET - fuel`. It then returns the gateway with `fuelReady`.
- **Lists:** `GET /console/invoices` and `GET /console/payments` page with the counts from `get_gateway`, from the newest index back, 100 per view call, and add token metadata.
- **Tokens and preferences:** `GET /console/tokens` returns the allowlist, metadata and each token's on/off state. `PUT /console/preferences {tokensOff}`.
- **Retry:** `POST /console/retry {payment}` answers 403 unless the payment's gateway is the session's and its status is `SettleFailed` or `RefundFailed`. The operator sends `retry`.
- **Token metadata:** `ft_metadata` results are cached in memory for the life of the process.

**8. Checkout.**
- `GET /checkout/invoice?id=` combines:
  - `get_invoice` (404 when null);
  - the merchant name, found by `gateway_id`;
  - the payment's status and `refund_to` when there is a payment;
  - token metadata.
- `GET /checkout/assets` lists the 1Click `/v0/tokens` entries whose `blockchain` passes `screenable(chain, EVM_CHAINS)`, which is true for `EVM_CHAINS`, `btc` and `zec`.
- `POST /checkout/quote`:
  1. **Validate:**
     - 400 "not a NEAR account id" for a bad `refundOnNear`;
     - 404 for an unknown invoice;
     - 409 unless the invoice is Open and not expired;
     - 422 "this origin chain can't be screened";
     - 502 "gateway token not deliverable by 1Click" when `destinationAsset` finds nothing.
  2. **Build the request:** `ref = randomBytes(16).hex`. `quoteRequest(...)` returns exactly:
     - `swapType: "EXACT_OUTPUT"`, `slippageTolerance: 100`
     - `originAsset`, `depositType: "ORIGIN_CHAIN"`
     - `destinationAsset`, `amount: invoice.amount`
     - `refundTo`, `refundType: "ORIGIN_CHAIN"`
     - `recipient: GATEFLOW_CONTRACT`, `recipientType: "DESTINATION_CHAIN"`
     - `deadline`: ISO of `min(now + 30 min, expires_at)`
     - `customRecipientMsg`: `JSON.stringify({invoice, ref, refund_to})`
     - `dry: false`
  3. **Record:** the `quotes` row is inserted, then the deposit address, memo, input amount, deadline and `ref` are returned. 1Click upstream errors become 502.
- `GET /checkout/status?depositAddress=` returns the 1Click `status`, plus `screening` from the `quotes` row.
- `POST /checkout/screen {depositAddress, ref}`:
  1. `ref` must match `/^[0-9a-f]{32}$/`;
  2. `get_payment_by_ref` (404 when null);
  3. 1Click `SUCCESS` (otherwise 409 with the status);
  4. `screen_intents` sent from the relay account, which is the operator in this deployment, with 300 Tgas;
  5. returns `{payment, txHash}` and marks the quote screened.
- **`destinationAsset(tokens, token)`:** the `blockchain == "near"` entry whose `assetId` is `nep141:<token>` or ends with `:nep141:<token>`, preferring the `1cs_v1:near:` form.
- **1Click base:** `ONECLICK_URL` (default `https://1click.chaindefuser.com`). `X-API-Key` is sent only when `ONECLICK_API_KEY` is set.

**9. Watcher.** `tick(deps)` runs every 15 s over quotes with `screened = 0` and `now ≤ deadline + 1 h`. For each one:
- `SUCCESS` → `get_payment_by_ref` → `screen_intents`. An `error` containing "screening already started" counts as screened.
- `REFUNDED` or `FAILED` → store the status and stop.
- No payment yet → retry on the next tick.

A failure on one quote never stops the others.

**10. Static.** `serveStatic(WEB_DIST, path)` serves files by extension and falls back to `index.html` for non-API GETs. A missing `WEB_DIST` gives 404 JSON, so the relay runs before `web/` exists.

**11. Contract edit.** In `contract/src/gateways.rs`, remove `require!(attached_deposit >= execution_deposit)` and keep `#[payable]`. The test `gateway_without_fuel_rejected` (`gateways.rs:124`) becomes `gateway_without_deposit_has_zero_fuel`.

**12. Live checks.**
- **Accounts:** `near account create-account sponsor-by-faucet-service` makes `gateflow-op-<rand>.testnet` (the operator, relay and `intents` on testnet) and `gateflow-dev-<rand>.testnet` (the contract). The person running it does this, and the keys go to the legacy keychain.
- **Contract:** deploy with `new(op, op, op, {outlayer: "outlayer.testnet", project: "<op>/gateflow-placeholder", secrets_owner: op}, 0.01 NEAR)`, then `add_token("wrap.testnet")`, then `storage_deposit` the contract on `wrap.testnet`. The key is **kept**: this is a dev deployment.
- **Dry quote:** a `LIVE=1`-gated test posts `quoteRequest({..., dry: true})` to live 1Click, for 1 USDC on mainnet (`nep141:17208628…`) from Base USDC, with recipient `wrap.near` (an existing mainnet account). It expects 200 with `quote.amountIn`.

## Risks / Trade-offs

- [Free gateways: the contract pays about 0.0015 NEAR of storage per gateway, and anyone can create them] → Accepted for the hackathon. The operator watches the contract balance and tops it up. A real fix (paid or relay-gated gateways) needs a new contract.
- [Operator nonce races across concurrent requests] → One send queue. Throughput is about one transaction per FINAL wait (~2 s), which is enough for a demo.
- [Unverified email gives read access to that email's merchant data] → Spec'd as a demo. Writes still need the passkey.
- [The quote deadline falls before a slow BTC swap finishes (about 13 min), or after invoice expiry] → The deadline is `min(now + 30 min, expiry)`. A 1Click delivery after expiry is refunded by the contract's never-panic path.
- [1Click does not support testnet] → Only a dry quote is checked live. A real quote and the watcher end to end run in `mainnet-launch` 2.x.
- [The placeholder enclave on the dev contract fails every screening] → Expected: such payments refund. Screening is checked by `mainnet-launch` 0.x.

## Migration Plan

1. Land the contract edit with `cargo test` green. No deployment exists, so there is no migration.
2. Build the relay with `node --test`, then run the live checks of decision 12.
3. Rollback: stop the process. The SQLite file and the dev contract can be discarded.
