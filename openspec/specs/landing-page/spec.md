# landing-page Specification

## Purpose

Explains Gateflow to signed-out visitors, such as hackathon judges and prospective merchants, in a five-slide deck. It covers what Gateflow is, why it is trustworthy, and how to try it, then hands off to the console sign-in.

## Requirements

### Requirement: Landing at the root, console at /console
The web app SHALL show the landing deck at `/` to every visitor, signed in or not. The console SHALL live under `/console`; a visitor without a session there SHALL see the sign-in card. The screen shown right after Sign out SHALL stay unchanged.

#### Scenario: Judge opens the root URL
- **WHEN** a visitor with no session cookie opens `/`
- **THEN** the landing deck shows slide 1

#### Scenario: Merchant with a session
- **WHEN** a signed-in merchant opens `/`
- **THEN** the landing deck shows, and "Launch console" opens the console Home at `/console`

#### Scenario: Checkout untouched
- **WHEN** a visitor opens `/pay/42`
- **THEN** the checkout page shows, not the deck

### Requirement: Five slides in a fixed order
The deck SHALL have exactly five slides in this order: Hook, Problem, How it works, Trust, Developers. Each slide SHALL fill the viewport, and the page SHALL never scroll in either direction at any viewport size.

#### Scenario: No page scroll
- **WHEN** the deck renders at 1440x900 or at 375x667
- **THEN** the document has no vertical or horizontal scroll

### Requirement: Hook slide
Slide 1 SHALL state "Stripe for Web2. Gateflow for Web3." and that a business accepts crypto from any chain within a stated number of minutes. It SHALL claim "Compliance built in", "Self-custody" and "Any chain". It SHALL show payments from NEAR, Ethereum, Solana, Bitcoin and Zcash, in that order, going straight to "Your business wallet", with no chain named on the merchant side, and label the other 1Click chains as coming. The header SHALL carry "Launch console".

#### Scenario: Value at a glance
- **WHEN** slide 1 shows
- **THEN** "Gateflow for Web3", the minutes figure, "Compliance built in", "Self-custody" and "Any chain" are all visible without interaction

#### Scenario: Networks shown
- **WHEN** slide 1 shows
- **THEN** the networks read NEAR, Ethereum, Solana, Bitcoin, Zcash from top to bottom

### Requirement: Problem slide
Slide 2 SHALL compare "Without Gateflow" (blockchain nodes, hot wallets and keys, bridges, a compliance vendor) with "With Gateflow" (one payment link), and state that there is no crypto backend to run. Labels SHALL stay legible: not struck through.

#### Scenario: Before and after
- **WHEN** slide 2 shows
- **THEN** the four "Without Gateflow" items and the "With Gateflow" payment link are visible side by side

### Requirement: How it works slide
Slide 3 SHALL show three steps:
1. The merchant signs in with their email; a passkey on the device secures the account.
2. The merchant shares an invoice link.
3. The buyer pays from NEAR, Ethereum, Solana, Bitcoin or Zcash, and the funds land in the merchant's own account.

#### Scenario: Three steps
- **WHEN** slide 3 shows
- **THEN** the three steps appear in order

### Requirement: Trust slide
Slide 4 SHALL say, in plain words, that every payer is checked against sanctions and fraud-risk lists in tamper-proof hardware (a TEE). It SHALL state, as separate points, that funds go only to the merchant's wallet or back to the payer and that Gateflow never holds keys, and show BYOK for AML and KYT providers as "Coming soon".

#### Scenario: BYOK not overclaimed
- **WHEN** slide 4 shows
- **THEN** BYOK carries a "Coming soon" label and is not described as available

### Requirement: Trust diagram
Slide 4 SHALL show a diagram of the buyer paying, the Gateflow logo labelled "TEE screening", and a fork: to the merchant's business wallet if the payer is clean, back to the buyer if flagged.

#### Scenario: Both outcomes shown
- **WHEN** slide 4 shows
- **THEN** "TEE screening", "Your business wallet" and "Back to buyer" are visible

### Requirement: TEE screening card
Slide 4 SHALL show a separate "TEE screening" card listing what the enclave checks (sanctions lists, fraud-risk score, the real sender across chains) and stating that verdicts come with a TEE attestation the merchant can check. On phones the card SHALL show only its heading.

#### Scenario: Card on desktop
- **WHEN** slide 4 shows at 1440x900
- **THEN** the card shows its heading, the three checks and the attestation line

### Requirement: Developers slide
Slide 5 SHALL be titled "Easy integration." and show a syntax-highlighted widget snippet of at most four lines: a script tag for `<origin>/js/v1/gateflow.js` and a `Gateflow.open(<invoice id>)` call. It SHALL show two calls to action: "Launch console" and Example shop. GitHub SHALL stay in the header.

#### Scenario: Snippet uses this origin
- **WHEN** the deck is served from `https://gateflow.example`
- **THEN** the snippet's script tag points to `https://gateflow.example/js/v1/gateflow.js`

### Requirement: Example shop link target
The Example shop link SHALL open the build-time configured shop URL. When no shop URL is configured, it SHALL open the `examples/shop` folder of the Gateflow repository on GitHub.

#### Scenario: Shop not hosted
- **WHEN** the app is built without a shop URL
- **THEN** Example shop links to `examples/shop` on GitHub

#### Scenario: Shop hosted
- **WHEN** the app is built with shop URL `https://shop.example`
- **THEN** Example shop links to `https://shop.example`

### Requirement: Honest claims
The deck SHALL claim only behaviour that ships today. It SHALL say "no crypto backend", never "no backend". It SHALL count only the networks a payer can use today (6), and label the other 1Click chains as coming soon. It SHALL show no network badge. Every slide SHALL carry a "Powered by NEAR" footer.

#### Scenario: Footer on every slide
- **WHEN** any slide shows
- **THEN** "Powered by NEAR" is visible and no testnet or mainnet label appears

### Requirement: Slide navigation
The deck SHALL move one slide at a time in response to:
- the arrow keys, Space and Page Up/Down
- a click on a slide dot
- one mouse-wheel or trackpad gesture, in either direction
- a horizontal or vertical touch swipe

Past the first or last slide it SHALL stay put.

#### Scenario: Keyboard
- **WHEN** slide 2 shows and the visitor presses ArrowRight
- **THEN** slide 3 shows

#### Scenario: One wheel gesture
- **WHEN** a trackpad gesture fires many wheel events within one gesture
- **THEN** the deck advances exactly one slide

#### Scenario: Scroll back and forth
- **WHEN** the visitor scrolls down one gesture and then up while the trackpad momentum still runs
- **THEN** the deck goes one slide forward and then one back

#### Scenario: Mouse wheel notches
- **WHEN** the visitor turns a mouse wheel one notch at a time with pauses
- **THEN** the deck advances one slide per notch

#### Scenario: Last slide
- **WHEN** slide 5 shows and the visitor presses ArrowRight
- **THEN** slide 5 still shows

### Requirement: Slide deep link
The URL hash SHALL reflect the current slide as `#1` to `#5` without adding history entries. Opening the landing page with a valid hash SHALL show that slide first. An invalid or missing hash SHALL show slide 1.

#### Scenario: Shared link
- **WHEN** a visitor with no session opens `/#4`
- **THEN** the Trust slide shows first

#### Scenario: Invalid hash
- **WHEN** a visitor opens `/#9`
- **THEN** slide 1 shows

### Requirement: Phone layout
On viewports narrower than 640 px, the deck SHALL keep one slide per screen with 16 px side gutters. It SHALL show shortened copy and SHALL hide the Developers code snippet, while keeping both calls to action.

#### Scenario: Phone
- **WHEN** slide 5 shows at 375 px width
- **THEN** the snippet is hidden and both calls to action are visible

### Requirement: Motion
Slide changes SHALL use a transition of about 300 ms. The How it works steps SHALL appear one after another when slide 3 opens. With `prefers-reduced-motion: reduce`, the deck SHALL change slides instantly and show every step at once.

#### Scenario: Reduced motion
- **WHEN** the visitor prefers reduced motion and presses ArrowRight
- **THEN** the next slide shows with no animation

### Requirement: Handoff to sign-in
"Launch console" SHALL open `/console`, which shows the existing sign-in card with a link back to the deck at `/`. After sign-in, onboarding and the console SHALL behave as before.

#### Scenario: Launch and back
- **WHEN** a visitor clicks "Launch console" and then the back link
- **THEN** the sign-in card shows, then the deck shows again

#### Scenario: Sign in from landing
- **WHEN** a new visitor clicks "Launch console" and signs in with `kaja@example.com`
- **THEN** onboarding starts
