import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, test } from "vitest";

/// Runs public/js/v1/gateflow.js against stub globals and returns its `window.Gateflow`.
function load(src = "https://gw.example/js/v1/gateflow.js") {
  const window: any = {};
  runInNewContext(readFileSync(new URL("../public/js/v1/gateflow.js", import.meta.url), "utf8"), {
    window,
    document: { currentScript: { src } },
    location: { origin: "https://shop.example" },
    URL,
    Number,
    String,
  });
  return window.Gateflow;
}

const frame = {};
const msg = (over: Record<string, unknown> = {}) => ({ origin: "https://gw.example", source: frame, data: { source: "gateflow", invoice: 42, status: "paid" }, ...over });

test("widget_defines_api", () => {
  const g = load();
  expect(typeof g.open).toBe("function");
  expect(typeof g.close).toBe("function");
  expect(typeof g.button).toBe("function");
});

test("widget_ignores_foreign_origin", () => {
  const g = load();
  expect(g._accepts(msg({ origin: "https://evil.example" }), "https://gw.example", frame)).toBe(false);
  expect(g._accepts(msg({ origin: "https://shop.example" }), "https://gw.example", frame)).toBe(false);
});

test("widget_ignores_foreign_source", () => {
  const g = load();
  expect(g._accepts(msg({ source: {} }), "https://gw.example", frame)).toBe(false);
  expect(g._accepts(msg({ data: { invoice: 42, status: "paid" } }), "https://gw.example", frame)).toBe(false);
  expect(g._accepts(msg({ data: null }), "https://gw.example", frame)).toBe(false);
  expect(g._accepts(msg(), "https://gw.example", null)).toBe(false);
});

test("widget_accepts_own_frame", () => {
  expect(load()._accepts(msg(), "https://gw.example", frame)).toBe(true);
});

test("widget_button_rejects_bad_invoice", () => {
  const g = load();
  expect(() => g.button("#pay", -1)).toThrow("invoice must be an id");
  expect(() => g.button("#pay", "abc")).toThrow("invoice must be an id");
});
