# Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-out visitors see a five-slide, no-scroll landing deck that explains Gateflow and hands off to the existing sign-in card.

**Architecture:** Pure navigation and link helpers live in `web/src/landing/logic.ts` and are unit-tested in vitest (node environment, no DOM). `web/src/landing/Landing.tsx` renders the slides and wires DOM events to those helpers. `web/src/landing/landing.css` owns layout, breakpoints and motion. `Console.tsx` shows the deck on 401 in place of `SignIn`.

**Tech Stack:** React 18, Vite, TypeScript, vitest. No new dependencies.

**Spec:** `openspec/changes/landing-page/specs/landing-page/spec.md`, `openspec/changes/landing-page/design.md`

## Global Constraints

- No new npm dependencies. Reuse `tokens.css` variables, `ds.jsx` `Button` and `Icon`, and `assets.ts` icons.
- Copy rules: say "no crypto backend", never "no backend". No testnet or mainnet label anywhere. "Powered by NEAR" on every slide. BYOK for AML and KYT providers is always labelled "Coming soon".
- Slides in order: Hook, Problem, How it works, Trust, Developers. The hash runs from `#1` to `#5`.
- Phone breakpoint: `max-width: 639px`, with 16 px side gutters.
- Transition about 300 ms. Wheel: 350 ms lock between steps, 150 ms gap marks a new impulse. Swipe threshold 50 px.
- GitHub `https://github.com/avelex/gateflow`. The shop falls back to `https://github.com/avelex/gateflow/tree/main/examples/shop`.
- Commits: short conventional style, ending with the attribution trailer.

## Review Focus

- The deck's key listener stays attached after "Launch console", so ArrowRight or Space in the email field changes slides or loses input. The listener must be removed on unmount (verified in 4.1).
- Space pressed on a focused CTA both activates the button and advances the slide. `keyStep` gets the target tag and returns 0 for Space on `BUTTON` or `A` (tested in 1.1).
- `overflow: hidden` on `<html>` is not restored after the hand-off, so the sign-in card or console cannot scroll. Restore it on unmount (verified in 4.1).
- A trackpad inertia tail advances two slides. The gate measures from the last event, not the first (tested in 1.2).
- A slow diagonal or tiny swipe (a tap on a link) changes the slide. Only the dominant axis at 50 px or more counts (tested in 1.1).

---

## 1. Navigation and link logic

**Files:** create `web/src/landing/logic.ts`, `web/src/landing/logic.test.ts`

**Produces:**
- `SLIDES = 5`
- `clamp(i: number): number`, which keeps a slide index within 0..4
- `fromHash(hash: string): number`, where `"#4"` gives 3 and anything invalid gives 0
- `toHash(i: number): string`, where 3 gives `"#4"`
- `keyStep(key: string, targetTag?: string): -1 | 0 | 1`
- `swipeStep(dx: number, dy: number): -1 | 0 | 1`
- `wheelGate(quietMs = 600): (now: number) => boolean`
- `shopUrl(env?: string): string`
- `snippet(origin: string): string`

- [x] 1.1 Write `logic.test.ts` and implement `clamp`, `fromHash`, `toHash`, `keyStep` and `swipeStep`. Verify that `cd web && npx vitest run src/landing` passes these assertions:
  - `clamp(-1) === 0`, `clamp(9) === 4`
  - `fromHash("#4") === 3`; `fromHash("#9")`, `fromHash("#0")`, `fromHash("#x")` and `fromHash("")` are all `0`
  - `toHash(0) === "#1"`
  - `keyStep` is `1` for `ArrowRight`, `ArrowDown`, `PageDown` and `" "`, and `-1` for `ArrowLeft`, `ArrowUp` and `PageUp`
  - `keyStep(" ", "BUTTON") === 0` and `keyStep(" ", "A") === 0`
  - `swipeStep(-80, 10) === 1`, `swipeStep(80, 10) === -1`, `swipeStep(5, -90) === 1`, `swipeStep(30, 20) === 0` (both under 50)
- [x] 1.2 Add tests and implement `wheelGate`. It accepts one event, then rejects events until `quietMs` has passed since the *last* event, accepted or not. Verify these assertions with `g = wheelGate(600)`:
  - `g(0) === true`
  - `g(100) === false`
  - `g(650) === false` (a stream every ~100 ms keeps it closed)
  - after a 700 ms gap from the last call, `g` returns `true`
- [x] 1.3 Add tests and implement `shopUrl` and `snippet`. Verify:
  - `shopUrl(undefined)` and `shopUrl("")` return the GitHub `examples/shop` URL
  - `shopUrl("https://shop.example") === "https://shop.example"`
  - `snippet("https://gateflow.example")` contains `<script src="https://gateflow.example/js/v1/gateflow.js"></script>` and `Gateflow.open(`, and has at most 4 lines

  Commit `feat(web): landing navigation logic`.

## 2. Deck

**Files:** create `web/src/landing/Landing.tsx` and `web/src/landing/landing.css`. Modify `web/src/assets.ts`, adding `export { default as nearLogo } from "./assets/chain-near.png"` and adding `near` to `CHAINS`.

**Consumes:** everything in group 1, plus `chainIcon` and `logo` from `assets.ts`.

**Produces:** a `default function Landing({ onLaunch }: { onLaunch: () => void })`.

- [x] 2.1 Build the five slides from one `SLIDES_COPY` array with the copy from the spec, a `MINUTES` constant (placeholder `3` until task 3.1 sets it), and a "Powered by NEAR" footer with `nearLogo`.
  - Slide 1: chain strip for `base`, `eth`, `arb`, `btc`, `zec`, `near`.
  - Slide 5: `snippet(location.origin)` in a `<pre>`, "Launch console" calling `onLaunch`, plus GitHub and Example shop (`shopUrl(import.meta.env.VITE_SHOP_URL)`) with `target="_blank" rel="noopener"`.

  Verify that `cd web && npm run build` passes (`tsc` included).
- [x] 2.2 Write `landing.css`:
  - a `100dvh` deck with stacked slides and an opacity plus translate transition of 300 ms
  - staggered step reveal on slide 3
  - `@media (prefers-reduced-motion: reduce)` turning off transitions and the stagger
  - `@media (max-width: 639px)`: 16 px gutters, a hidden `.landing-snippet`, and a hidden `.landing-long` for long copy
  - type sized with `clamp()`

  Verify by eye in task 4.1.
- [x] 2.3 Wire the events in `Landing.tsx`:
  - the start index from `fromHash(location.hash)`
  - `history.replaceState(null, "", toHash(i))` on every change
  - `keydown` on `window` through `keyStep(e.key, (e.target as Element).tagName)`
  - `wheel` (passive) through one `wheelGate()`, using the sign of `deltaY` (or of `deltaX` when that is larger)
  - `touchstart` and `touchend` through `swipeStep`
  - dots as buttons with `aria-label="Slide n"` and `aria-current` on the current one
  - `document.documentElement.style.overflow = "hidden"` on mount

  The effect cleanup removes every listener and restores the previous `overflow`. Verify that `npm run build` passes, then commit `feat(web): landing deck`.

## 3. Console hand-off and the minutes figure

**Files:** modify `web/src/console/Console.tsx` and `web/src/console/SignIn.tsx`.

- [x] 3.1 In `Console.tsx`:
  - add `{ kind: "landing" }` to `State`
  - make 401 set `landing` instead of `signin`
  - render `<Landing onLaunch={() => setState({ kind: "signin" })} />`

  In `SignIn.tsx`, add an optional `onBack?: () => void` that renders a "Back" text button under the form. `Console` passes `onBack={() => setState({ kind: "landing" })}`. `SignedOut` and the `onUnauthorized` path stay unchanged. Verify that `cd web && npx vitest run && npm run build` passes. Then, against a running relay, check:
  - a fresh browser at `/` shows the deck
  - "Launch console" shows the sign-in card
  - "Back" shows the deck
  - signing in with a new email starts onboarding

  Commit `feat(web): show landing to signed-out visitors`.
  - 2026-11-06: verified against a stub relay (401 without a session, onboarding `step: account` after `POST /console/session`, `step: done` with a session cookie), not the real relay. Commits deferred: work is on `main` and not yet committed.
- [ ] 3.2 Time one onboarding run on the deployed relay, from the email sign-in to the first invoice link copied. Set `MINUTES` to that time rounded up to a whole minute, and note the measured time in this task line. Verify the slide 1 copy shows the new number. Commit `docs(web): measured onboarding time on landing`.

## 4. Integration check

- [x] 4.1 With `npm run build` served by the relay, use a browser (Playwright) to check each of these:
  - **No scroll:** at 1440x900, 1366x768 and 375x667, `document.documentElement.scrollHeight <= innerHeight` and `scrollWidth <= innerWidth` on every slide.
  - **Navigation:** ArrowRight from `/#2` shows slide 3 and the URL becomes `/#3` with `history.length` unchanged. ArrowRight on slide 5 stays on slide 5.
  - **Deep links:** `/#4` opens on Trust, and `/#9` opens on Hook.
  - **Phone:** at 375 px the snippet is hidden and all three CTAs show.
  - **Reduced motion:** with `emulateMedia({ reducedMotion: "reduce" })`, computed `transition-duration` on slides is `0s`.
  - **After hand-off:** after "Launch console", typing `a b` with arrow keys in the email field keeps the text and doesn't change slides, and `<html>` overflow is restored.
  - **Signed in:** with a session, `/` shows the console Home.
  - **Checkout:** `/pay/<id>` shows the checkout.

  Fix anything that fails in the group that owns it.
  - 2026-11-06: design feedback rounds 1 and 2 applied (copy, before/after, trust fork diagram, syntax highlighting, wheel gate rewritten to impulse detection so scrolling works back and forth). Spec, proposal and design updated to match.
  - 2026-11-06: ran on the Vite dev server (port 5199) with the stub relay, headless Chromium. All checks passed. The page follows `hashchange` too, so editing the hash in the address bar switches slides. `src/App.test.ts` fails already on `main` before this change (`ReferenceError: location is not defined` at `checkout/Checkout.tsx:19`), unrelated.

## Workflow follow-up

- After merge, follow up with the reusable payment links change. Once it ships, add the "Try a live payment" CTA and update the "no code" copy.
- Set `VITE_SHOP_URL` once the example shop is hosted.
- Archive this change after review.
