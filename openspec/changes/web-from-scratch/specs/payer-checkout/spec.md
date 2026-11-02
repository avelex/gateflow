# Spec Delta

## MODIFIED Requirements

### Requirement: Pay with a NEAR wallet
The page SHALL offer paying from a NEAR wallet through wallet-selector by calling `ft_transfer_call` on the invoice token to the Gateflow contract with the invoice amount and `msg` `{"invoice": <id>}`. Before payment it SHALL warn that current screening refunds payments sent from named NEAR accounts such as `alice.near`, and that paying from another chain avoids this.

#### Scenario: Named account warned
- **WHEN** a payer chooses the NEAR wallet option
- **THEN** the page shows the named-account warning, pointing to paying from another chain, before the wallet opens

#### Scenario: Direct payment sent
- **WHEN** the wallet confirms the transfer
- **THEN** the page switches to the status timeline for that invoice

#### Scenario: Message names the invoice only
- **WHEN** a payer pays invoice 7 from a NEAR wallet
- **THEN** the `ft_transfer_call` carries `msg` exactly `{"invoice":7}`, with no gateway field
