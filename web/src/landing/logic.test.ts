import { expect, test } from "vitest";
import { clamp, fromHash, highlight, keyStep, shopUrl, snippet, swipeStep, toHash, wheelGate } from "./logic.ts";

test("clamp", () => {
  expect(clamp(-1)).toBe(0);
  expect(clamp(9)).toBe(4);
  expect(clamp(2)).toBe(2);
});

test("hash", () => {
  expect(fromHash("#4")).toBe(3);
  for (const h of ["#9", "#0", "#x", "", "#", "#1.5"]) expect(fromHash(h)).toBe(0);
  expect(toHash(0)).toBe("#1");
  expect(toHash(3)).toBe("#4");
});

test("key_step", () => {
  for (const k of ["ArrowRight", "ArrowDown", "PageDown", " "]) expect(keyStep(k)).toBe(1);
  for (const k of ["ArrowLeft", "ArrowUp", "PageUp"]) expect(keyStep(k)).toBe(-1);
  expect(keyStep("a")).toBe(0);
  expect(keyStep(" ", "BUTTON")).toBe(0);
  expect(keyStep(" ", "A")).toBe(0);
  expect(keyStep("ArrowRight", "INPUT")).toBe(0);
});

test("swipe_step", () => {
  expect(swipeStep(-80, 10)).toBe(1);
  expect(swipeStep(80, 10)).toBe(-1);
  expect(swipeStep(5, -90)).toBe(1);
  expect(swipeStep(5, 90)).toBe(-1);
  expect(swipeStep(30, 20)).toBe(0);
});

/// Trackpad swipe: deltas rise, then momentum decays, one event every 16 ms.
const swipe = (start: number, sign: 1 | -1, n = 90) => Array.from({ length: n }, (_, i) => [start + i * 16, sign * (i < 4 ? 10 * (i + 1) : Math.max(1, Math.round(40 * 0.93 ** (i - 4))))] as const);
const run = (gate: ReturnType<typeof wheelGate>, events: readonly (readonly [number, number])[]) => events.map(([t, d]) => gate(t, d)).filter((s) => s !== 0);

test("wheel_gate_one_swipe_one_step", () => {
  expect(run(wheelGate(), swipe(0, 1))).toEqual([1]);
});

test("wheel_gate_mouse_notches", () => {
  expect(run(wheelGate(), [[0, 100], [400, 100], [800, 100]])).toEqual([1, 1, 1]);
  expect(run(wheelGate(), [[0, 100], [40, 100], [80, 100]])).toEqual([1]); // one fast spin
});

test("wheel_gate_back_and_forth", () => {
  const back = swipe(500, -1); // reversed swipe while the first one's momentum still runs
  const events = [...swipe(0, 1).filter(([t]) => t < 500), ...back];
  expect(run(wheelGate(), events)).toEqual([1, -1]);
});

test("wheel_gate_new_swipe_over_momentum", () => {
  const events = [...swipe(0, 1).filter(([t]) => t < 700), ...swipe(700, 1)];
  expect(run(wheelGate(), events)).toEqual([1, 1]);
});

test("wheel_gate_ignores_zero", () => {
  expect(wheelGate()(0, 0)).toBe(0);
});

test("shop_url", () => {
  const gh = "https://github.com/avelex/gateflow/tree/main/examples/shop";
  expect(shopUrl(undefined)).toBe(gh);
  expect(shopUrl("")).toBe(gh);
  expect(shopUrl("https://shop.example")).toBe("https://shop.example");
});

test("snippet", () => {
  const s = snippet("https://gateflow.example");
  expect(s).toContain('<script src="https://gateflow.example/js/v1/gateflow.js"></script>');
  expect(s).toContain('Gateflow.button("#pay", 42)');
  expect(s.split("\n").length).toBeLessThanOrEqual(4);
});

test("highlight", () => {
  const code = snippet("https://gateflow.example");
  const toks = highlight(code);
  expect(toks.map((t) => t.s).join("")).toBe(code);
  expect(toks).toContainEqual({ t: "tag", s: "<script" });
  expect(toks).toContainEqual({ t: "attr", s: "src" });
  expect(toks).toContainEqual({ t: "str", s: '"https://gateflow.example/js/v1/gateflow.js"' });
  expect(toks).toContainEqual({ t: "tag", s: "</script" });
  expect(toks).toContainEqual({ t: "str", s: '"#pay"' });
});
