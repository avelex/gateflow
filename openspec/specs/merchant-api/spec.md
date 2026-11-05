# merchant-api Specification

## Purpose
Lets a shop's server create Gateflow invoices per order over plain HTTP with a secret API key, and learn their outcome through signed webhooks, without the shop handling NEAR keys, wallets or gas.

## Requirements

### Requirement: Invoice signer key
The relay SHALL hold one invoice signer key. A merchant enables the API by adding that key's public key to their account as a FunctionCall access key with receiver the Gateflow contract and methods `[create_invoice]` only, and disables it by deleting that key. API invoice creation SHALL fail with 409 while the merchant's account lacks this key.

#### Scenario: API not enabled
- **WHEN** a shop posts a valid API key for a merchant who has not enabled the API
- **THEN** the relay answers 409 "API is not enabled" and creates no invoice

#### Scenario: API disabled after use
- **WHEN** the merchant deletes the signer key and the shop then posts an invoice
- **THEN** the relay answers 409 and creates no invoice

### Requirement: Relay accepts only the scoped signer key action
When relaying a merchant-signed delegate action whose receiver is the merchant's own account, the relay SHALL sponsor only one `AddKey` of the signer public key with exactly that FunctionCall permission, or one `DeleteKey` of the signer public key. It SHALL refuse any other key action, including full-access keys and deleting any other key.

#### Scenario: Full-access key refused
- **WHEN** a session posts a delegate action adding a full-access key to the merchant account
- **THEN** the relay refuses it and sends nothing

#### Scenario: Wider method list refused
- **WHEN** the delegate action adds the signer key with methods `[create_invoice, set_policy]`
- **THEN** the relay refuses it

#### Scenario: Passkey key protected
- **WHEN** the delegate action deletes the merchant's passkey public key
- **THEN** the relay refuses it

### Requirement: API keys
The console SHALL let a merchant create API keys with a label. A key SHALL be `gf_live_` on mainnet or `gf_test_` on testnet followed by 32 random bytes in base62, shown once at creation. The relay SHALL store only its SHA-256 hash, label, last four characters and creation time. A merchant SHALL be able to hold several keys and revoke each one, effective immediately.

#### Scenario: Key shown once
- **WHEN** Kaja creates a key labelled "shop" and later reopens Settings
- **THEN** Settings lists "shop" with its last four characters and does not show the full key

#### Scenario: Revoked key
- **WHEN** Kaja revokes a key and the shop then calls the API with it
- **THEN** the relay answers 401

### Requirement: API authentication
Every `/api/v1/*` request SHALL carry `Authorization: Bearer <key>`. A missing, unknown or revoked key SHALL get 401. A key SHALL act only on its own merchant's gateway.

#### Scenario: Other merchant's invoice
- **WHEN** Kaja's key requests an invoice of another gateway
- **THEN** the relay answers 404

### Requirement: Create an invoice over HTTP
`POST /api/v1/invoices` SHALL accept JSON `{amount, currency, order_id?, expires_in_sec?}`. `amount` is a positive decimal string, `currency` is the display symbol of an allowlisted token (`USDC`, `BTC`, `ZEC`) that the merchant has not switched off, and `expires_in_sec` defaults to 1800 within the contract's bounds. The relay SHALL create the invoice on-chain with `order_id` as memo and answer 201 with the invoice object.

#### Scenario: Order invoice
- **WHEN** the shop posts `{"amount":"10.00","currency":"USDC","order_id":"order_123"}`
- **THEN** the relay answers 201 with `id`, `url` ending `/pay/<id>`, `status` `open`, `amount` `10.00`, `currency` `USDC`, `order_id` `order_123` and `expires_at`

#### Scenario: Bad input
- **WHEN** the amount is `0`, has more decimals than the token, the currency is unknown, or `order_id` is over 140 bytes
- **THEN** the relay answers 422 with the field at fault and creates no invoice

### Requirement: Order id deduplication
When a create request names an `order_id` that already has an API invoice of the same gateway which is Open and unexpired, the relay SHALL answer 200 with that invoice instead of creating another, regardless of amount or currency in the new request.

#### Scenario: Retried request
- **WHEN** the shop posts the same `order_id` twice within the invoice's lifetime
- **THEN** both answers carry the same `id` and only one invoice exists on-chain

#### Scenario: After expiry
- **WHEN** the earlier invoice for `order_123` has expired and the shop posts `order_123` again
- **THEN** the relay creates a new invoice

### Requirement: Read an invoice over HTTP
`GET /api/v1/invoices/<id>` SHALL return the invoice object with `status` read from the chain: `open`, `paying`, `paid`, `returned` or `expired`. It SHALL answer 404 for an unknown id or one of another gateway.

#### Scenario: Paid invoice
- **WHEN** the shop reads an invoice whose payment settled
- **THEN** the answer's `status` is `paid`

### Requirement: Rate limit
The relay SHALL allow at most 60 invoice creations per gateway per minute through the API and answer 429 with `Retry-After` beyond that.

#### Scenario: Burst
- **WHEN** a shop posts 61 new invoices within one minute
- **THEN** the 61st gets 429 and is not created

### Requirement: Webhook configuration
The console SHALL let a merchant set one HTTPS webhook URL per gateway. Setting it SHALL generate a `whsec_` secret shown once; the merchant SHALL be able to roll the secret and clear the URL.

#### Scenario: Non-HTTPS URL
- **WHEN** Kaja enters `http://shop.example/hook`
- **THEN** the console refuses it

### Requirement: Webhook events
For every API-created invoice of a gateway with a webhook URL, the relay SHALL send one event per transition: `invoice.paying` when a payment opens, `invoice.paid` when it settles, `invoice.returned` when it is refunded, and `invoice.expired` when an Open invoice passes its expiry. The body SHALL be `{event, created_at, data}` with `data` the invoice object.

#### Scenario: Settled order
- **WHEN** an API invoice moves from Open through Paying to Paid
- **THEN** the shop receives `invoice.paying` and then `invoice.paid`, each carrying `order_id`

#### Scenario: Abandoned cart
- **WHEN** an API invoice stays Open past its expiry
- **THEN** the shop receives `invoice.expired` once

### Requirement: Webhook signature
Each webhook POST SHALL carry `Gateflow-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`.

#### Scenario: Shop verifies
- **WHEN** the shop computes HMAC-SHA256 with its `whsec_` secret over `<t>.<raw body>`
- **THEN** it equals the `v1` value

### Requirement: Webhook retries
A delivery SHALL succeed on any 2xx answer within 10 seconds. Otherwise the relay SHALL retry after about 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours, then give up. Events of one invoice SHALL be delivered in transition order.

#### Scenario: Shop down
- **WHEN** the shop answers 500 to `invoice.paid` twice and 200 on the third attempt
- **THEN** the relay stops retrying after the third attempt
