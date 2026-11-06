# Design

## Context

`web/src/console/Console.tsx` loads `GET /console/me`. On 401 it renders the `SignIn` card, and after Sign out it renders `SignedOut`. The landing deck takes over only the 401 branch. The web app has no router library: `App.tsx` maps paths by hand. Styling comes from `tokens.css`, the `ds.jsx` components and inline styles. Tests run in vitest against pure logic modules (`console/logic.ts`, `checkout/logic.ts`), with no DOM environment.

## Goals / Non-Goals

**Goals:**
- One self-contained landing module with no new dependencies.
- Navigation logic that is pure and unit-tested. The component only wires DOM events to it.

**Non-Goals:**
- A route of its own, SEO meta or server-side rendering.
- Analytics, i18n, or a dark/light theme switch beyond what `tokens.css` already gives.

## Decisions

- **Placement: the 401 branch, not a route.** Console state gets a new `landing` kind, which becomes the 401 result. "Launch console" moves to `signin`, and `SignIn` gets an optional `onBack` that returns to `landing`. `SignedOut` stays as it is. *Alternative:* a separate `/welcome` route with redirects. It was rejected because judges open `/`, and a route would also need redirect rules for signed-in users.
- **Files.** The deck goes in `web/src/landing/Landing.tsx` and its pure navigation logic in `web/src/landing/logic.ts`, with `logic.test.ts` beside them. Layout, breakpoints and motion go in `web/src/landing/landing.css`. Media queries, `prefers-reduced-motion` and staggered steps belong in CSS; inline styles cannot express them.
- **Navigation logic.**
  - `clamp(i)`
  - `fromHash("#4") -> 3` (anything invalid gives 0)
  - `toHash(3) -> "#4"`
  - `keyStep(key) -> -1 | 0 | 1`
  - `swipeStep(dx, dy)`, with a threshold of about 50 px on the dominant axis
  - a wheel gate that steps once per gesture: a step needs a fresh impulse (a pause of 150 ms or more before the event, a delta jump over decaying trackpad momentum, or a direction reversal) and 350 ms since the last step. A plain quiet-window gate (the first version, 600 ms) swallowed mouse-wheel notches and back-swipes during a momentum tail.
- **Hash.** Use `history.replaceState`, so slide changes add no history entries and the Back button still leaves the site. The hash is read on mount and on `hashchange`, so editing it in the address bar switches slides.
- **Slides layout.** Use one `100dvh` container with `overflow: hidden` on the page while the deck is mounted. Slides stack and change with an opacity plus translate transition (300 ms). *Alternative:* CSS scroll-snap. It was rejected because the spec forbids page scroll, and scroll-snap shows a scrollbar and lets inertia skip slides.
- **Snippet origin.** Build it from `location.origin`, the same origin the relay serves the widget from.
- **Links.**
  - GitHub: the constant `https://github.com/avelex/gateflow`.
  - Shop: `import.meta.env.VITE_SHOP_URL`, falling back to `https://github.com/avelex/gateflow/tree/main/examples/shop`.
  - Both open in a new tab with `rel="noopener"`.
- **Assets.** Reuse `chainIcon` from `assets.ts`. Add the existing `chain-near.png` to `assets.ts` for the NEAR logo and the "Powered by NEAR" footer.
- **Minutes figure.** It is a single constant in `Landing.tsx`. Its value comes from one timed onboarding run on the deployed relay, measured from sign-in to the first invoice link and rounded up.

## Risks / Trade-offs

- [Dense slides overflow short viewports, such as a laptop at 1366x768 with the browser chrome showing] → Size type with `clamp()` against `dvh`, and check 1366x768 and 375x667 during verification.
- [Wheel gating misreads an unusual device] → `lockMs` and `gapMs` are parameters of `wheelGate`; tune them on real hardware.
- [Claims drift as features ship or change] → Keep all copy in one array of slide objects in `Landing.tsx`, so updating it is one edit. BYOK's "Coming soon" label is the first thing to flip.
- [Making 401 show the deck adds a click for returning merchants with expired sessions] → Accepted. A session lasts until sign-out, and the click is one button.
