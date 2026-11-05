# Spec Delta

## ADDED Requirements

### Requirement: Developers settings
Settings SHALL have a Developers section. While the API is disabled it SHALL show only an Enable API button, which triggers one passkey prompt for adding the invoice signer key. Once enabled, it SHALL show API keys, the webhook URL with its secret controls, allowed origins, and a Disable API button that triggers one passkey prompt for deleting the key.

#### Scenario: Enable API
- **WHEN** Kaja presses Enable API and confirms the passkey prompt
- **THEN** the section shows API keys, webhook and allowed origins controls

#### Scenario: Disable API
- **WHEN** Kaja presses Disable API and confirms the passkey prompt
- **THEN** the signer key is removed from Kaja's account and the section shows only Enable API

### Requirement: Integration snippet
The Developers section SHALL show copyable examples of a `curl` invoice creation with a placeholder key and of the widget script tag with `Gateflow.open`, using the relay's own origin.

#### Scenario: Copy snippet
- **WHEN** Kaja copies the widget snippet
- **THEN** it names `/js/v1/gateflow.js` on the relay Kaja is signed in to
