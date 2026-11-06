// Pure navigation and link helpers for the landing deck.

export const SLIDES = 5;
export const GITHUB = "https://github.com/avelex/gateflow";
const SHOP_ON_GITHUB = `${GITHUB}/tree/main/examples/shop`;
const SWIPE_PX = 50;

export const clamp = (i: number): number => Math.max(0, Math.min(SLIDES - 1, i));

/// "#4" -> 3; anything that is not #1..#5 -> 0.
export function fromHash(hash: string): number {
  const m = /^#([1-9])$/.exec(hash);
  return m && Number(m[1]) <= SLIDES ? Number(m[1]) - 1 : 0;
}

export const toHash = (i: number): string => `#${i + 1}`;

const NEXT = new Set(["ArrowRight", "ArrowDown", "PageDown", " "]);
const PREV = new Set(["ArrowLeft", "ArrowUp", "PageUp"]);

/// Slide step for a key. Space on a focused button or link activates it instead; keys typed into a field are ignored.
export function keyStep(key: string, targetTag?: string): -1 | 0 | 1 {
  if (targetTag === "INPUT" || targetTag === "TEXTAREA" || targetTag === "SELECT") return 0;
  if (key === " " && (targetTag === "BUTTON" || targetTag === "A")) return 0;
  return NEXT.has(key) ? 1 : PREV.has(key) ? -1 : 0;
}

/// Step for a touch move of (dx, dy): only the dominant axis counts, and only past SWIPE_PX. Swiping left or up goes forward.
export function swipeStep(dx: number, dy: number): -1 | 0 | 1 {
  const d = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
  return Math.abs(d) < SWIPE_PX ? 0 : d < 0 ? 1 : -1;
}

/// Slide step for each wheel event: one per gesture, back and forth.
/// A step needs a fresh impulse (a pause before the event, a jump in delta over decaying trackpad momentum, or a
/// reversal) and at least `lockMs` since the last step, so momentum tails never count twice.
export function wheelGate(lockMs = 350, gapMs = 150): (now: number, delta: number) => -1 | 0 | 1 {
  let lastAt = -Infinity;
  let lastStep = -Infinity;
  let lastAbs = 0;
  let lastDir = 0;
  return (now, delta) => {
    const dir = Math.sign(delta);
    if (dir === 0) return 0;
    const abs = Math.abs(delta);
    const impulse = now - lastAt >= gapMs || dir !== lastDir || (abs >= 15 && abs > lastAbs * 1.5);
    const step = impulse && now - lastStep >= lockMs;
    lastAt = now;
    lastAbs = abs;
    lastDir = dir;
    if (!step) return 0;
    lastStep = now;
    return dir as -1 | 1;
  };
}

export const shopUrl = (env?: string): string => env || SHOP_ON_GITHUB;

export const snippet = (origin: string): string =>
  `<script src="${origin}/js/v1/gateflow.js"></script>\n<button onclick="Gateflow.open(42)">Pay with crypto</button>`;

export type Token = { t: "tag" | "attr" | "str" | "text"; s: string };

/// Splits the HTML snippet into coloured runs. Covers tags, attribute names and quoted values; everything else is text.
export function highlight(code: string): Token[] {
  const out: Token[] = [];
  const re = /(<\/?[\w-]+|\/?>)|([\w-]+)(?==)|("[^"]*")/g;
  let at = 0;
  for (const m of code.matchAll(re)) {
    if (m.index > at) out.push({ t: "text", s: code.slice(at, m.index) });
    out.push({ t: m[1] ? "tag" : m[2] ? "attr" : "str", s: m[0] });
    at = m.index + m[0].length;
  }
  if (at < code.length) out.push({ t: "text", s: code.slice(at) });
  return out;
}
