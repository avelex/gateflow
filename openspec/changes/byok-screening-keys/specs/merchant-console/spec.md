# Spec Delta

## ADDED Requirements

### Requirement: Screening providers settings
Settings SHALL have a Screening providers tab that shows the built-in checks (GoPlus for EVM addresses, OFAC lists for Bitcoin and Zcash) as always on, and Chainalysis Sanctions as Not connected or Active with the key's last 4 characters. Connecting SHALL accept a pasted key and run the sealed-storage flow with passkey prompts; Remove SHALL run the removal flow. The tab SHALL state that the key is encrypted in the browser and readable only by the screening enclave.

#### Scenario: Connect
- **WHEN** Kaja pastes a Chainalysis key and confirms the passkey prompts
- **THEN** the tab shows Chainalysis Sanctions as Active with the key's last 4 characters

#### Scenario: Remove
- **WHEN** Kaja presses Remove and confirms
- **THEN** the tab shows Chainalysis Sanctions as Not connected
