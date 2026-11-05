# checkout-widget Specification

## Purpose
Lets a shop open Gateflow checkout for an invoice on its own page with one script tag, follow its status for the UI, or redirect to the hosted page and back.

## Requirements

### Requirement: Widget script
The relay SHALL serve `/js/v1/gateflow.js`, a dependency-free script that defines `window.Gateflow` with `open(invoiceId, options?)` and `close()`. Its public interface SHALL stay compatible for as long as `v1` is served. The script SHALL be usable from any origin.

#### Scenario: Script tag
- **WHEN** a shop page includes `<script src="https://<relay>/js/v1/gateflow.js"></script>`
- **THEN** `window.Gateflow.open` is a function

### Requirement: Checkout modal
`Gateflow.open(id)` SHALL show a centered modal over the shop page with a dimmed backdrop and a close button, holding an iframe of `/pay/<id>?embed=1`. On a viewport narrower than 480 px the modal SHALL fill the screen. Closing SHALL remove the modal and SHALL NOT affect the payment.

#### Scenario: Open and close
- **WHEN** the shop calls `Gateflow.open(42)` and the buyer presses close
- **THEN** the iframe of invoice 42 appears, then the modal is gone and the page is as before

### Requirement: Status events
`options.onStatus` SHALL be called with `{invoice, status}` whenever the embedded checkout reports a change, where `status` is one of `open`, `paying`, `paid`, `returned`, `expired` or `closed` (the buyer closed the modal). Events are for the shop's UI only; documentation SHALL state that fulfilment must rely on the webhook or the invoices API.

#### Scenario: Paid in modal
- **WHEN** the buyer pays and the payment settles while the modal is open
- **THEN** `onStatus` receives `paying` and then `paid` for that invoice

### Requirement: Allowed origins
The console SHALL let a merchant keep a list of allowed origins (`https://host[:port]`) per gateway. The embedded checkout SHALL send status messages only to the parent origin when it is on the invoice gateway's list, and the script SHALL accept messages only from the relay origin. With an empty list the embedded checkout SHALL show the invoice but send no status messages.

#### Scenario: Unlisted origin
- **WHEN** a page on `https://evil.example` embeds Kaja's invoice and Kaja's list holds only `https://shop.example`
- **THEN** the page receives no status messages

### Requirement: Redirect fallback
`/pay/<id>?return_url=<url>` SHALL, once the invoice is Paid, Returned or expired, show a "Back to shop" link to `return_url` with `invoice` and `status` added as query parameters. A `return_url` whose origin is not on the gateway's allowed origins SHALL be ignored.

#### Scenario: Back to shop
- **WHEN** a buyer opens `/pay/42?return_url=https://shop.example/done` and the payment settles
- **THEN** the page links to `https://shop.example/done?invoice=42&status=paid`

#### Scenario: Open redirect blocked
- **WHEN** `return_url` is `https://evil.example/` and that origin is not allowed
- **THEN** the page shows no back link
