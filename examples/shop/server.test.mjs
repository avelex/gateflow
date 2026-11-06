import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { applyEvent, handleWebhook, priceCart, webhookLog } from "./server.mjs";

test("price_sums_micro_units", () => {
  const { lines, total } = priceCart([
    { id: "espresso", qty: 1 },
    { id: "beans", qty: 1 },
  ]);
  assert.equal(total, "0.015");
  assert.deepEqual(lines.map((l) => [l.id, l.qty, l.price]), [["espresso", 1, "0.01"], ["beans", 1, "0.005"]]);
});

test("price_rejects_unknown", () => assert.throws(() => priceCart([{ id: "nope", qty: 1 }]), /unknown/));

test("price_rejects_bad_qty", () => {
  for (const qty of [0, 11, 1.5, "2"]) assert.throws(() => priceCart([{ id: "espresso", qty }]), /quantity/);
});

test("price_rejects_empty", () => {
  assert.throws(() => priceCart([]), /empty/);
  assert.throws(() => priceCart(undefined), /empty/);
});

test("price_rejects_duplicate", () => assert.throws(() => priceCart([{ id: "espresso", qty: 1 }, { id: "espresso", qty: 1 }]), /twice/));

test("event_moves_forward", () => {
  assert.equal(applyEvent({ status: "pending" }, "invoice.paying"), "paying");
  assert.equal(applyEvent({ status: "paying" }, "invoice.paid"), "paid");
  assert.equal(applyEvent({ status: "pending" }, "invoice.expired"), "expired");
  assert.equal(applyEvent({ status: "paying" }, "invoice.returned"), "returned");
});

test("event_repeat_is_noop", () => assert.equal(applyEvent({ status: "paid" }, "invoice.paid"), null));

test("event_late_paying_after_paid_is_noop", () => {
  assert.equal(applyEvent({ status: "paid" }, "invoice.paying"), null);
  assert.equal(applyEvent({ status: "expired" }, "invoice.paid"), null);
  assert.equal(applyEvent({ status: "pending" }, "invoice.unknown"), null);
});

test("webhook_bad_sig_logged", () => {
  const body = JSON.stringify({ event: "invoice.paid", data: { order_id: "ord_x", status: "paid" } });
  const t = Math.floor(Date.now() / 1000);
  assert.equal(handleWebhook(`t=${t},v1=${"0".repeat(64)}`, body, "whsec_test").status, 400);
  assert.deepEqual([webhookLog[0].event, webhookLog[0].sig_ok], ["invoice.paid", false]);

  const v1 = createHmac("sha256", "whsec_test").update(`${t}.${body}`).digest("hex");
  assert.equal(handleWebhook(`t=${t},v1=${v1}`, body, "whsec_test").status, 200);
  assert.deepEqual([webhookLog[0].order_id, webhookLog[0].sig_ok], ["ord_x", true]);
});
