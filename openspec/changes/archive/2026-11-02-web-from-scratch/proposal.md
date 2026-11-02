# Proposal

## Why

Gateflow's web app is specified in `merchant-console`, `payer-checkout` and the browser parts of `merchant-accounts`, but the repository has no code for it. The relay already serves `WEB_DIST` and every route the app needs. Without the app, merchants cannot onboard without a script and payers have no checkout page. This change writes it from scratch, as the contract, enclave and relay changes did. `console-ai-chat` is blocked on it.

Two specs no longer match the system:
- The NEAR wallet payment sends `msg` `{"gateway", "invoice"}`, but the contract's `PayMsg` is `{"invoice", "refund_to"?, "ref"?}`.
- The named-account warning recommends an Ethereum wallet, which is not wired.

## What Changes

- **New `web/`:** a Vite, React and TypeScript app, built into `web/dist` and served by the relay from one origin.
  - **Design from `design/`:** screens are translated 1:1 from `design/Gateflow Console.html` and `design/Gateflow Checkout.html`: markup, inline styles, copy, tokens, fonts and images. The exports' 19 design-system components are used as they are, not rewritten.
    - Left out, because their features are outside this change: Chat, Recents, BYOK, the Travel Rule form and checks, the ownership-signature step, and the email and explorer links.
    - Screens the exports lack are composed from the same components and layout: sign-in, onboarding, the recovery phrase, the Gateway settings tab and the cross-chain quote fields.
  - **Merchant console:**
    - demo email sign-in and resumable onboarding;
    - Home, Invoices, Screening, Settings and Search;
    - polling against the existing `/console/*` API.
  - **Merchant key:**
    - derived in the browser from a passkey's WebAuthn PRF output, with a recovery-phrase key as the fallback;
    - every write is a NEP-366 delegate action signed in WebCrypto and posted to `/console/relay`.
  - **Public checkout at `/pay/<id>`:**
    - the invoice card and unpayable states;
    - paying from a NEAR wallet through wallet-selector;
    - paying from another chain through a 1Click quote with a deposit address and QR code;
    - the four-step status timeline.
- **Checkout `msg` fixed:** the direct payment's `msg` is `{"invoice": <id>}`.
- **Named-account warning:** it now points the payer to paying from another chain.
- **Relay:** `GET /checkout/invoice` also returns the contract account, the `ft_transfer_call` receiver.
- **Live check:** a console run on the testnet dev deployment, plus a NEAR wallet payment that the placeholder enclave refunds.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `payer-checkout`: "Pay with a NEAR wallet" sends `{"invoice"}` as `msg`, and its warning recommends paying from another chain.
- `checkout-relay`: "Checkout invoice details" also returns the Gateflow contract account.

## Impact

- **`web/`:** new code with Vitest suites. Dependencies: React 18.3.1 and `lucide` 0.469.0 (the exports' versions), Vite, Vitest, `@near-wallet-selector/*` and `qrcode`. Delegate Borsh is hand-written and checked against the relay's encoder.
- **`relay/`:** one field added to the checkout invoice response, with its test.
- **Docs:** README Status, plus a `web/README.md`.
- **Out of scope:** the Ethereum-wallet payer option, the chat assistant, a live cross-chain payment (1Click is mainnet only) and a settled payment (the placeholder enclave refunds all).
