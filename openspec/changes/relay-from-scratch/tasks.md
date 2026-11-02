# Relay From Scratch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. OpenSpec tracks only the `- [ ] N.M` lines; the numbered steps under each task are its TDD cycle and are not tracked separately.

**Goal:** Write `relay/`, Gateflow's single backend process (console API, checkout API, screening watcher, static web), and let `create_gateway` work without a deposit.

**Architecture:**
- Handlers are plain async functions `(req, deps) => res`. `deps` holds the config, a `node:sqlite` DB, a NEAR client and a 1Click client.
- `main.ts` wires the real clients into a `node:http` server. Tests wire fakes.
- NEAR transactions are hand-built: Borsh, base58 and `node:crypto` ed25519.

**Tech Stack:** Node 26 (TypeScript run directly, erasable syntax only), `node:http`, `node:sqlite`, `node:crypto` and `node:test`. No npm dependencies. Rust near-sdk 5 for the one contract edit.

**Spec:**
- `openspec/specs/checkout-relay/spec.md`, `openspec/specs/sponsored-transactions/spec.md` and `openspec/specs/merchant-accounts/spec.md` (backend requirements).
- `openspec/changes/relay-from-scratch/specs/` (the deltas).
- `openspec/changes/relay-from-scratch/design.md`.

## Global Constraints

- `relay/package.json`: `{"name":"gateflow-relay","private":true,"type":"module","engines":{"node":">=26"},"scripts":{"test":"node --test \"src/*.test.ts\"","start":"node src/main.ts"}}`, with no `dependencies`. Imports use `.ts` extensions.
- No `enum`, parameter properties or namespaces: Node strips types and does not transpile.
- Env, with defaults:
  - `GATEFLOW_CONTRACT` (required);
  - `RELAY_ACCOUNT_ID` and `RELAY_PRIVATE_KEY` (required for writes);
  - `NEAR_RPC_URL` = `https://rpc.testnet.fastnear.com`;
  - `PUBLIC_URL` = `http://localhost:8787`, and the port comes from it;
  - `DB_PATH` = `gateflow.db`;
  - `WEB_DIST` = `../web/dist`;
  - `FUEL_TARGET` = `100000000000000000000000`;
  - `EXECUTION_DEPOSIT` = `10000000000000000000000`;
  - `MAX_MERCHANTS` = `100`;
  - `ONECLICK_URL` = `https://1click.chaindefuser.com`;
  - `ONECLICK_API_KEY` (optional);
  - `EVM_CHAINS` = `base,eth,arb`.
- Sponsorship allowlist:
  - the receiver is `GATEFLOW_CONTRACT`;
  - every action is a FunctionCall to `create_gateway`, `create_invoice` or `set_policy`, with deposit `0` and gas ≤ `100000000000000`;
  - the sender is the session's `account_id`;
  - there is at least one action.
- NEP-366 signing hash: `sha256(u32le(2^30 + 366) || borsh(DelegateAction))`.
- Borsh action tags: CreateAccount `0`, FunctionCall `2`, Transfer `3`, AddKey `5` (FullAccess permission tag `1`), Delegate `8`.
- Provisioning:
  - the account is `<slug>.<RELAY_ACCOUNT_ID>`, with a Transfer of `10000000000000000000000` (0.01 NEAR);
  - steps `account → tokens → gateway → done`;
  - the default `max_risk` is `50`.
- Fuel: top up when `fuel < 2n * EXECUTION_DEPOSIT`, attaching `FUEL_TARGET - fuel`. After `create_gateway`, attach `FUEL_TARGET`.
- Cookie: `gateflow_session=<64 hex>; HttpOnly; SameSite=Lax; Path=/`, plus `; Secure` when `PUBLIC_URL` starts with `https:`.
- `customRecipientMsg` is exactly `JSON.stringify({invoice, ref, refund_to})`, in that key order.
- Quote deadline: `min(now + 30 min, expires_at_sec * 1000)`, as an ISO string.
- Watcher: every `15000` ms. It stops on `screened`, on `REFUNDED` or `FAILED`, or when `now > deadline_ms + 3600000`.
- Errors are JSON `{error}`. `/checkout/*` responses add `Access-Control-Allow-Origin: *` and answer `OPTIONS` with 204.
- Amounts are `bigint` or decimal strings, never JS numbers.
- Commits: short conventional style, one per task.

## Review Focus

- A signed delegate with zero actions must be refused, not relayed as an empty sponsored transaction. Test `empty_actions_refused` (2.2).
- A relayed `create_gateway` that fails on-chain must answer 422 and leave `step = gateway`, with no `fund` sent. Test `create_gateway_failure_keeps_step` (3.3).
- Two concurrent `POST /console/onboard` calls for one email must create one account. Test `onboard_concurrent_single_account` (3.2).
- An invoice whose token has no 1Click NEAR asset must answer 502 before any quote or DB row. Test `quote_undeliverable_token` (4.2).
- A 1Click error for one recorded quote must not stop the watcher for the others. Test `watcher_isolates_failures` (4.3).

---

## 1. Contract

- [x] 1.1 Let `create_gateway` work without a deposit (design decision 11). Verify that `cd contract && cargo test` passes, including the renamed test
  **Files:** `contract/src/gateways.rs`.
  1. Replace the test `gateway_without_fuel_rejected` with `gateway_without_deposit_has_zero_fuel`. A call with 0 attached returns id 0, and `get_gateway(0).fuel == 0`.
  2. Run: FAIL ("attach at least one execution deposit"). 3. Remove the `require!` on line 12 and update the doc comment. 4. Run: PASS. 5. Commit `feat(contract): create gateways without a deposit`.

## 2. Foundation

- [x] 2.1 Package, NEAR primitives and signing. Verify that `cd relay && npm test` passes the tests below
  **Files:** `relay/package.json`, `relay/.gitignore` (`*.db`), `relay/src/near.ts`, `relay/src/near.test.ts`, `relay/src/fixtures/tx-panic.json` and `tx-success.json` (hand-written `send_tx` FINAL shapes: `receipts_outcome[].outcome.{executor_id,status}`).
  **Produces:**
  - `base58encode(b: Uint8Array): string` and `base58decode(s: string): Uint8Array`
  - `type Action = {createAccount: true} | {transfer: bigint} | {addFullAccessKey: Uint8Array} | {functionCall: {method: string; args: object; gas: bigint; deposit: bigint}} | {signedDelegate: Uint8Array}`
  - `encodeActions(actions: Action[]): Uint8Array`
  - `signer(secret: string): {accountPk: Uint8Array; sign(msg: Uint8Array): Uint8Array}`
  - `txResult(rpc: any, gateflow: string): TxResult`, where `TxResult = {hash: string; value?: unknown; error?: string}`
  - `interface Near { view(contract, method, args): Promise<any>; send(receiver, actions): Promise<TxResult>; accountExists(id): Promise<boolean>; accessKey(account, publicKey): Promise<{nonce: bigint} | undefined>; head(): Promise<{height: bigint; hash: Uint8Array}> }`
  - `rpcNear(cfg): Near`, which queues every `send` through one promise chain.
  1. Tests:
     - `base58_roundtrip`: includes leading zero bytes.
     - `actions_borsh_create_account`: `[0]`.
     - `actions_borsh_transfer`: `[3, …u128le]`.
     - `actions_borsh_add_full_access_key`: tag 5, key type 0, 32 bytes, nonce u64 0, permission 1.
     - `actions_borsh_function_call_deposit`: tag 2, method, JSON args bytes, gas u64, deposit u128.
     - `signature_verifies`: a `node:crypto` verify with the derived public key.
     - `tx_result_panic`: `error === "invalid expiry"`.
     - `tx_result_value`: `value === 3`.
  2. Run: FAIL. 3. Implement. 4. Run: PASS. 5. Commit `feat(relay): NEAR transactions and signing`.
- [x] 2.2 Delegate decoding and the allowlist. Verify that `npm test` passes the tests below
  **Files:** `relay/src/delegate.ts`, `relay/src/delegate.test.ts`.
  **Consumes:** 2.1's Borsh helpers.
  **Produces:**
  - `type DelegateAction = {senderId; receiverId; actions: Action[]; nonce: bigint; maxBlockHeight: bigint; publicKey: Uint8Array}`
  - `encodeDelegateAction(d): Uint8Array`
  - `signDelegate(d, secret): string`, which gives base64 of the SignedDelegate Borsh and is used by tests and the live script
  - `decodeSignedDelegate(b64): DelegateAction & {raw: Uint8Array}`
  - `refusal(d, sessionAccount, gateflow): string | undefined`
  1. Tests:
     - `delegate_roundtrip`: sign, then decode, gives equal fields.
     - `delegate_hash_prefix`: the first 4 bytes are `6e 01 00 40`.
     - `allowlist_accepts_create_invoice`.
     - `transfer_refused`.
     - `other_sender_refused`.
     - `other_receiver_refused`.
     - `deposit_refused`: 1 yocto.
     - `gas_cap_refused`: 101 Tgas.
     - `method_refused`: `fund`.
     - `mixed_actions_refused`.
     - `empty_actions_refused`.
  2. Run: FAIL. 3. Implement. 4. Run: PASS. 5. Commit `feat(relay): delegate allowlist`.
- [x] 2.3 Database, static files and the server shell. Verify that `npm test` passes the tests below, and that `GATEFLOW_CONTRACT=x node src/main.ts` serves `GET /console/nope` → 404 `{"error":"not found"}`
  **Files:** `relay/src/types.ts`, `relay/src/db.ts`, `relay/src/static.ts`, `relay/src/main.ts`, and tests `db.test.ts`, `static.test.ts`, `main.test.ts`.
  **Produces:**
  - `types.ts`: `Config`, `Deps = {cfg; db; near: Near; oneclick: OneClick; now(): number}`, `interface OneClick { tokens(): Promise<any[]>; quote(body: object): Promise<any>; status(depositAddress: string): Promise<any> }`, `Req`, `Res`, `class HttpError extends Error { status: number }` (with a plain constructor body), and `type Handler = (req: Req, deps: Deps) => Promise<Res>`.
  - `openDb(path)`: helpers `merchantByEmail`, `merchantByAccount`, `merchantByGateway`, `merchantCount`, `upsertMerchant`, `createSession`, `sessionEmail`, `deleteSession`, `insertQuote`, `quoteByDeposit`, `openQuotes(nowMs)`, `markQuote(ref, {status?, screened?})`.
  - `serveStatic(dir, pathname)`.
  - `dispatch(routes: Record<string, Handler>, req, deps): Promise<Res>`, keyed by `"GET /console/me"` and so on, which maps `HttpError` and adds CORS on `/checkout/*`.
  1. Tests:
     - `db_merchant_roundtrip`.
     - `db_quote_lifecycle`: `openQuotes` excludes screened quotes and quotes past `deadline + 1h`.
     - `static_spa_fallback`: `/pay/7` gives `index.html`.
     - `static_api_404_json`.
     - `dispatch_maps_http_error`.
     - `checkout_cors_and_options`.
  2. Run: FAIL. 3. Implement. 4. Run: PASS, plus the manual 404 check. 5. Commit `feat(relay): sqlite, static web and server shell`.

## 3. Console

- [x] 3.1 Email sessions. Verify that `npm test` passes `session_sets_cookie_flags`, `session_secure_on_https`, `session_rejects_bad_email` (400, no cookie), `me_requires_session` (401) and `logout_deletes_session` (the old cookie then gets 401)
  **Files:** `relay/src/console.ts`, `relay/src/console.test.ts`, plus `relay/src/testing.ts` (`fakeDeps(overrides)` with a `":memory:"` DB, a recording fake `Near`, a fake `OneClick` and a fixed `now`).
  **Produces:** handlers `POST /console/session {email}` → `{step}`, `DELETE /console/session`, and `GET /console/me` → `{email, name, accountId, gatewayId, step}`. Also `requireMerchant(req, deps)`, which throws 401.
  Steps: 1. tests FAIL. 2. implement. 3. PASS. 4. Commit `feat(relay): demo email sessions`.
- [x] 3.2 Provisioning. Verify that `npm test` passes the tests below
  **Produces:** `slug(name): string`, and `POST /console/onboard {name, publicKey, payoutTo?}` → `{step, accountId}` (design decision 4).
  1. Tests:
     - `slug_basic`: "Kaja Coffee" gives `kaja-coffee`.
     - `slug_non_latin_falls_back`: "Кафе" gives `merchant`.
     - `slug_trimmed_32`.
     - `slug_suffix_when_taken`: `accountExists` is true once, so the result is `kaja-coffee-2.<op>`.
     - `onboard_account_tx_actions`: the recorded send is CreateAccount, Transfer 0.01 NEAR, AddKey(pk).
     - `onboard_registers_every_token`: one `storage_deposit` per `get_tokens` entry, with `storage_balance_bounds.min` attached.
     - `onboard_twice_resumes`.
     - `onboard_key_mismatch_409`.
     - `merchant_cap_enforced`.
     - `onboard_concurrent_single_account`.
  2. FAIL. 3. Implement. 4. PASS. 5. Commit `feat(relay): merchant account provisioning`.
- [x] 3.3 Delegate params and relaying, including the gateway step. Verify that `npm test` passes the tests below
  **Consumes:** `decodeSignedDelegate`, `refusal` and `Near.send`.
  **Produces:** `GET /console/delegate-params` → `{nonce, maxBlockHeight, publicKey}` (as strings), and `POST /console/relay {signedDelegate}` → `{txHash, value}`.
  1. Tests:
     - `delegate_params_nonce_plus_one`.
     - `relay_refused_403_sends_nothing`.
     - `relay_invoice_returns_id`.
     - `relay_panic_422`: the message is passed through.
     - `create_gateway_sets_gateway_and_funds`: the next send is `fund` with `FUEL_TARGET`, and `step == done`.
     - `create_gateway_failure_keeps_step`.
  2. FAIL. 3. Implement. 4. PASS. 5. Commit `feat(relay): sponsored delegate actions`.
- [ ] 3.4 Console data, top-up, preferences and retry. Verify that `npm test` passes the tests below
  **Produces:** `needsTopUp(fuel: bigint, deposit: bigint): boolean`, plus handlers `GET /console/gateway`, `GET /console/invoices`, `GET /console/payments`, `GET /console/tokens`, `PUT /console/preferences {tokensOff: string[]}` and `POST /console/retry {payment}`.
  1. Tests:
     - `needs_top_up`: the boundary is exactly `2 × deposit`, which needs no top-up.
     - `gateway_tops_up_before_return`.
     - `invoices_newest_first_paged`: 150 invoices give two view calls, and the newest comes first.
     - `tokens_respect_preferences`.
     - `preferences_reject_unknown_token` (400).
     - `retry_only_failed_own_payment`: another gateway's payment gives 403, and `Settled` gives 403.
     - `metadata_cached`: one `ft_metadata` call per token across two requests.
  2. FAIL. 3. Implement. 4. PASS. 5. Commit `feat(relay): console data, fuel and retry`.

## 4. Checkout

- [ ] 4.1 Invoice details and quotable assets. Verify that `npm test` passes the tests below
  **Files:** `relay/src/checkout.ts`, `relay/src/checkout.test.ts`, `relay/src/fixtures/oneclick-tokens.json` (a copy of `enclave/tests/fixtures/oneclick-tokens.json`, plus the NEAR USDC, `nbtc.bridge.near` and `1cs_v1:near:nep141:zec.omft.near` entries taken from live `/v0/tokens`).
  **Produces:** `destinationAsset(tokens, token)`, `originChain(tokens, assetId)`, `screenable(chain, evmChains)`, and the handlers `GET /checkout/invoice?id=` and `GET /checkout/assets`.
  1. Tests:
     - `usdc_destination`.
     - `nbtc_destination`.
     - `zec_destination`: the `1cs_v1:` form.
     - `base_is_screenable`.
     - `solana_not_screenable`.
     - `assets_screenable_only`.
     - `checkout_invoice_404`.
     - `checkout_invoice_paying`: the payment status and `refund_to` are included, along with the merchant name.
  2. FAIL. 3. Implement. 4. PASS. 5. Commit `feat(relay): checkout invoice and assets`.
- [ ] 4.2 Quote, status and screen. Verify that `npm test` passes the tests below
  **Produces:** `quoteRequest(p: {invoiceId: number; amount: string; originAsset; destinationAsset; refundTo; refundOnNear; ref; recipient; deadlineMs: number; dry: boolean}): object`, plus `POST /checkout/quote`, `GET /checkout/status` and `POST /checkout/screen`.
  1. Tests:
     - `quote_request_shape`: an exact `deepEqual`, including `customRecipientMsg === '{"invoice":7,"ref":"<ref>","refund_to":"bob.near"}'`.
     - `quote_records_row`.
     - `quote_bad_refund_on_near_400`.
     - `quote_unknown_invoice_404`.
     - `quote_expired_409`.
     - `quote_solana_422`.
     - `quote_undeliverable_token`: 502, with no row.
     - `quote_upstream_502`.
     - `deadline_capped_by_expiry`.
     - `status_includes_screening`.
     - `screen_unknown_ref_404`: no 1Click call is made.
     - `screen_bad_ref_400`.
     - `screen_pending_409`.
     - `screen_success_sends_screen_intents`: 300 Tgas, and the row is marked screened.
  2. FAIL. 3. Implement. 4. PASS. 5. Commit `feat(relay): checkout quotes and deferred screening`.
- [ ] 4.3 Watcher. Verify that `npm test` passes the tests below, and that `main.ts` starts `setInterval(() => tick(deps), 15000)`
  **Files:** `relay/src/watcher.ts`, `relay/src/watcher.test.ts`.
  **Produces:** `tick(deps): Promise<void>`.
  1. Tests:
     - `watcher_screens_on_success`.
     - `watcher_already_started_counts_as_screened`.
     - `watcher_waits_for_payment`: no payment yet means nothing is sent and the row stays open.
     - `watcher_stops_on_refunded`.
     - `watcher_stops_after_deadline`.
     - `watcher_isolates_failures`.
  2. FAIL. 3. Implement. 4. PASS. 5. Commit `feat(relay): screening watcher`.

## 5. Live checks and docs

- [ ] 5.1 Dev deployment and the testnet run (design decision 12). Verify each check below and record the tx hashes in `relay/README.md`
  1. The owner creates `gateflow-op-<rand>.testnet` and `gateflow-dev-<rand>.testnet` with `near account create-account sponsor-by-faucet-service`. Build the contract (`cd contract && cargo near build non-reproducible-wasm`), deploy it to the dev account with `new(...)` as in decision 12, call `add_token("wrap.testnet")`, and `storage_deposit` the dev contract on `wrap.testnet`.
  2. Start the relay with `GATEFLOW_CONTRACT=<dev> RELAY_ACCOUNT_ID=<op> RELAY_PRIVATE_KEY=<op key>`.
  3. Write `relay/scripts/merchant.ts`. It generates a merchant key, calls `session`, `onboard`, then `delegate-params`, then signs and posts `create_gateway`, then `create_invoice` for 1 wNEAR.
  4. Checks:
     - `near account list-keys <slug>.<op>` shows exactly the merchant's key;
     - `get_gateway` shows the merchant as owner, with fuel equal to `FUEL_TARGET`;
     - `GET /console/invoices` lists the invoice;
     - `GET /checkout/invoice?id=0` shows `Open` and the merchant name;
     - `GET /checkout/assets` contains BTC and no Solana asset;
     - a delegate with a Transfer gets 403.
- [ ] 5.2 Live dry quote. Verify that `LIVE=1 node --test src/live.test.ts` passes: `quoteRequest({…, dry: true})` for 1 USDC (`nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`, `amount "1000000"`) from Base USDC, with recipient `wrap.near`, gets 200 with `quote.amountIn`. Without `LIVE`, the test is skipped
  - Commit `test(relay): live dry quote`.
- [ ] 5.3 Docs. Verify that every README command in the relay sections runs as written, and that `openspec validate relay-from-scratch --strict` passes
  - `relay/README.md`: the module map, `npm test`, the 5.1 run steps, and the recorded hashes.
  - `README.md`:
    - in the Status section, the relay is implemented and checked on testnet, `web/` is not yet in the repository, and `GOAL.md` is still missing;
    - the `cd relay && node --test src/*.test.ts` line becomes `cd relay && npm test`.
  - Commit `docs: relay status and runbook`.

## Workflow follow-up

- Run `/opsx:archive relay-from-scratch` after review. This syncs the `merchant-gateways` and `checkout-relay` deltas.
