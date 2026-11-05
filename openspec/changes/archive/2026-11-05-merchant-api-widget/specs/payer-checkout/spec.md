# Spec Delta

## ADDED Requirements

### Requirement: Embed mode
`/pay/<id>?embed=1` SHALL show only the invoice card and payment column, without the page header and footer, with a background suited to a modal, and SHALL report status changes to the parent window as the checkout widget specifies.

#### Scenario: Embedded page
- **WHEN** the widget loads `/pay/42?embed=1`
- **THEN** the page shows the amount, network list and timeline and no site header

### Requirement: NEAR wallet in a new tab when embedded
In embed mode, after the payer picks NEAR, the Browser wallet method SHALL show an "Open in new tab" action that opens `/pay/<id>` in a new browser tab instead of starting wallet-selector inside the frame. The embedded page SHALL keep polling and advance its timeline when the payment made in the other tab arrives.

#### Scenario: NEAR from modal
- **WHEN** the payer picks NEAR in the modal, pays in the new tab, and returns
- **THEN** the modal's timeline shows the payment delivered and screened

#### Scenario: Cross-chain stays in frame
- **WHEN** the payer picks Base in the modal
- **THEN** the deposit address and QR show inside the modal
