import { expect, test } from "vitest";
import { type CheckoutInvoice, timeline, unpayable } from "./logic.ts";

const base: CheckoutInvoice = {
  id: 7, gateway: 0, merchant: "Kaja Coffee", contract: "gateflow.near", token: "nbtc.bridge.near", symbol: "nBTC", decimals: 8,
  amount: "1000000", memo: null, expiresAtSec: 2_000_000_000, status: "Open", payment: null,
};
const inv = (o: Partial<CheckoutInvoice>) => ({ ...base, ...o });
const states = (t: ReturnType<typeof timeline>) => t.map((s) => `${s.label}:${s.state}`);

test("unpayable_states", () => {
  expect(unpayable(inv({ status: "Paid" }), 0)).toBe("paid");
  expect(unpayable(inv({ status: "Returned" }), 0)).toBe("returned");
  expect(unpayable(inv({ status: "Paying" }), 3_000_000_000)).toBeUndefined();
  expect(unpayable(inv({ status: "Open" }), 0)).toBeUndefined();
});

test("unpayable_at_expiry_boundary", () => {
  expect(unpayable(inv({ expiresAtSec: 100 }), 100)).toBe("expired");
  expect(unpayable(inv({ expiresAtSec: 101 }), 100)).toBeUndefined();
});

test("timeline_direct_pending", () => {
  const t = timeline(inv({ status: "Paying", payment: { id: 1, status: "Pending", refundTo: "bob.near" } }));
  expect(states(t)).toEqual(["Delivered to contract:done", "Screening in enclave:current", "Released to merchant:todo"]);
});

test("timeline_cross_chain_detected", () => {
  const t = timeline(inv({}), "PROCESSING");
  expect(states(t)).toEqual(["Deposit detected:done", "Delivered to contract:current", "Screening in enclave:todo", "Released to merchant:todo"]);
  expect(states(timeline(inv({}), "PENDING_DEPOSIT"))[0]).toBe("Deposit detected:current");
});

test("timeline_paid", () => {
  const t = timeline(inv({ status: "Paid", payment: { id: 1, status: "Settled", refundTo: "bob.near" } }), "SUCCESS");
  expect(t.at(-1)).toEqual({ label: "Released to merchant", state: "done" });
  expect(t.every((s) => s.state === "done")).toBe(true);
});

test("timeline_returned", () => {
  const t = timeline(inv({ status: "Returned", payment: { id: 1, status: "Refunded", refundTo: "bob.near" } }));
  expect(t.at(-1)).toEqual({ label: "Returned to you", state: "done", detail: "bob.near" });
});

test("timeline_origin_refund", () => {
  const t = timeline(inv({}), "REFUNDED");
  expect(t[0]).toMatchObject({ label: "Returned on the origin chain", state: "done" });
  expect(t.slice(1).map((s) => s.state)).toEqual(["todo", "todo", "todo"]);
});

import { transferCallArgs } from "./logic.ts";

test("transfer_call_args", () => {
  const a = transferCallArgs(inv({ id: 7, token: "wrap.testnet", contract: "gateflow-dev-v1.testnet", amount: "1000000000000000000000000" }));
  expect(a).toEqual({
    receiverId: "wrap.testnet",
    method: "ft_transfer_call",
    args: { receiver_id: "gateflow-dev-v1.testnet", amount: "1000000000000000000000000", msg: '{"invoice":7}' },
    gas: "300000000000000",
    deposit: "1",
  });
});
