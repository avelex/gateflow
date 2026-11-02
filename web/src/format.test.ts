import { expect, test } from "vitest";
import { formatAmount, isNearAccount, parseAmount, timeLeft } from "./format.ts";

test("format_amount_no_float", () => {
  expect(formatAmount(1n, 24)).toBe("0.000000000000000000000001");
  expect(formatAmount(1000000n, 6)).toBe("1");
  expect(formatAmount(10000000n, 8)).toBe("0.1");
  expect(formatAmount(0n, 6)).toBe("0");
  expect(formatAmount(12345n, 0)).toBe("12345");
});

test("parse_amount_exact", () => {
  expect(parseAmount("0.01", 8)).toBe(1000000n);
  expect(parseAmount("1", 24)).toBe(10n ** 24n);
  expect(parseAmount(" 2.5 ", 6)).toBe(2500000n);
});

test("parse_amount_rejects", () => {
  expect(() => parseAmount("0.0000001", 6)).toThrow();
  for (const bad of ["0", "1e3", "-1", "", "1,5", ".", "0.000"]) expect(() => parseAmount(bad, 6)).toThrow();
});

test("near_account_ids", () => {
  for (const ok of ["alice.near", "kaja-coffee.gateflow-op-v1.testnet", "a".repeat(64)]) expect(isNearAccount(ok)).toBe(true);
  for (const bad of ["Alice.near", "a", "bad..near", "a".repeat(65)]) expect(isNearAccount(bad)).toBe(false);
});

test("time_left_format", () => {
  expect(timeLeft(3900)).toBe("1h 05m");
  expect(timeLeft(249)).toBe("4m 09s");
  expect(timeLeft(45)).toBe("45s");
  expect(timeLeft(0)).toBe("0s");
  expect(timeLeft(-5)).toBe("0s");
});
