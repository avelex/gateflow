import { test } from "node:test";
import assert from "node:assert/strict";
import { deliver, isPrivateAddress, retryAt, signature, type WebhookIo } from "./webhooks.ts";
import { fakeDeps } from "./testing.ts";

test("signature_vector", () => {
  assert.equal(signature("whsec_test", 1700000000, '{"event":"invoice.paid"}'), "t=1700000000,v1=077eac2560374241495a59b09acae4af6039b1b3ba6e399bcd7a9a0771bdf192");
});

test("retry_schedule", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((a) => retryAt(a, 0)), [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]);
  assert.equal(retryAt(6, 0), undefined);
});

test("private_addresses", () => {
  for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "garbage"])
    assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"]) assert.equal(isPrivateAddress(ip), false, ip);
});

/// A gateway-0 API invoice with a webhook, a fake IO that answers `statuses` in turn and records calls.
function setup(url = "https://shop.example/hook", address = "93.184.216.34", statuses: number[] = [200]) {
  const deps = fakeDeps();
  deps.db.insertApiInvoice({ invoice: 7, gateway: 0, order_id: "o1", expires_at_ms: 0 });
  deps.db.setWebhook(0, url, "whsec_test");
  const calls: { url: string; init: RequestInit }[] = [];
  const io: WebhookIo = {
    async lookup() {
      return { address };
    },
    async fetch(u, init) {
      calls.push({ url: u, init });
      return { status: statuses.shift() ?? 200 };
    },
  };
  return { deps, io, calls };
}

test("deliver_signs_body", async () => {
  const { deps, io, calls } = setup();
  deps.db.queueDelivery(7, "invoice.paid", '{"event":"invoice.paid"}', deps.now());
  await deliver(deps, io);
  assert.equal(calls.length, 1);
  const t = Math.floor(deps.now() / 1000);
  assert.equal((calls[0].init.headers as any)["gateflow-signature"], signature("whsec_test", t, '{"event":"invoice.paid"}'));
  assert.equal(calls[0].init.redirect, "manual");
  await deliver(deps, io);
  assert.equal(calls.length, 1);
});

test("deliver_order", async () => {
  const { deps, io, calls } = setup(undefined, undefined, [500, 200, 200]);
  deps.db.queueDelivery(7, "invoice.paying", "paying", deps.now());
  deps.db.queueDelivery(7, "invoice.paid", "paid", deps.now());
  await deliver(deps, io);
  assert.deepEqual(calls.map((c) => c.init.body), ["paying"]);
  await deliver(deps, io);
  assert.equal(calls.length, 1, "paid waits while paying backs off");
  deps.clock.ms += 60_000;
  await deliver(deps, io);
  await deliver(deps, io);
  assert.deepEqual(calls.map((c) => c.init.body), ["paying", "paying", "paid"]);
});

test("deliver_retry_then_ok", async () => {
  const { deps, io, calls } = setup(undefined, undefined, [500, 500, 200]);
  deps.db.queueDelivery(7, "invoice.paid", "paid", deps.now());
  for (const wait of [0, 60_000, 300_000, 1_800_000]) {
    deps.clock.ms += wait;
    await deliver(deps, io);
  }
  assert.equal(calls.length, 3);
});

test("deliver_gives_up_after_retries", async () => {
  const { deps, io, calls } = setup(undefined, undefined, Array(10).fill(500));
  deps.db.queueDelivery(7, "invoice.paid", "paid", deps.now());
  for (let i = 0; i < 8; i++) {
    await deliver(deps, io);
    deps.clock.ms += 43_200_000;
  }
  assert.equal(calls.length, 6);
});

test("webhook_refuses_private", async () => {
  const { deps, io, calls } = setup("https://10.0.0.5/hook");
  deps.db.queueDelivery(7, "invoice.paid", "paid", deps.now());
  await deliver(deps, io);
  assert.equal(calls.length, 0);
  const v6 = setup("https://[::1]/hook");
  v6.deps.db.queueDelivery(7, "invoice.paid", "paid", v6.deps.now());
  await deliver(v6.deps, v6.io);
  assert.equal(v6.calls.length, 0);
});

test("webhook_refuses_resolved_private", async () => {
  const { deps, io, calls } = setup("https://evil.example/hook", "127.0.0.1");
  deps.db.queueDelivery(7, "invoice.paid", "paid", deps.now());
  await deliver(deps, io);
  assert.equal(calls.length, 0);
});

import { eventsFor, watchApiInvoices } from "./webhooks.ts";

function watched(webhook = true) {
  const deps = fakeDeps({ publicUrl: "https://gw.example" });
  const chain: Record<number, any> = { 7: { gateway: 0, token: "usdc.testnet", amount: "10000000", expires_at_sec: Math.floor(deps.now() / 1000) + 600, memo: "o1", status: "Open", payment: null } };
  deps.near.viewTable["gateflow.testnet.get_invoice"] = ({ invoice }: any) => chain[invoice] ?? null;
  deps.near.viewTable["usdc.testnet.ft_metadata"] = { symbol: "USDC", decimals: 6 };
  deps.db.insertApiInvoice({ invoice: 7, gateway: 0, order_id: "o1", expires_at_ms: (chain[7].expires_at_sec) * 1000 });
  if (webhook) deps.db.setWebhook(0, "https://shop.example/hook", "whsec_test");
  return { deps, chain };
}

/// Every queued delivery's event and parsed body, oldest first; marks them delivered.
function allDeliveries(deps: ReturnType<typeof fakeDeps>) {
  const out: any[] = [];
  for (let d = deps.db.dueDeliveries(Number.MAX_SAFE_INTEGER)[0]; d; d = deps.db.dueDeliveries(Number.MAX_SAFE_INTEGER)[0]) {
    out.push({ event: d.event, body: JSON.parse(d.body) });
    deps.db.updateDelivery(d.id, 1, null, true);
  }
  return out;
}

test("events_for_transitions", () => {
  assert.deepEqual(eventsFor("open", "open"), []);
  assert.deepEqual(eventsFor("open", "paying"), ["invoice.paying"]);
  assert.deepEqual(eventsFor("open", "paid"), ["invoice.paying", "invoice.paid"]);
  assert.deepEqual(eventsFor("paying", "returned"), ["invoice.returned"]);
  assert.deepEqual(eventsFor("open", "expired"), ["invoice.expired"]);
});

test("watch_queues_paying_paid", async () => {
  const { deps, chain } = watched();
  await watchApiInvoices(deps);
  assert.deepEqual(allDeliveries(deps), []);
  chain[7].status = "Paying";
  await watchApiInvoices(deps);
  chain[7].status = "Paid";
  await watchApiInvoices(deps);
  await watchApiInvoices(deps);
  const got = allDeliveries(deps);
  assert.deepEqual(got.map((g) => g.event), ["invoice.paying", "invoice.paid"]);
  assert.deepEqual(Object.keys(got[1].body).sort(), ["created_at", "data", "event"]);
  assert.equal(got[1].body.data.order_id, "o1");
  assert.equal(got[1].body.data.status, "paid");
  assert.deepEqual(deps.db.liveApiInvoices(), []);
});

test("watch_expired_once", async () => {
  const { deps } = watched();
  deps.clock.ms += 600_000;
  await watchApiInvoices(deps);
  await watchApiInvoices(deps);
  assert.deepEqual(allDeliveries(deps).map((g) => g.event), ["invoice.expired"]);
});

test("watch_no_webhook_url_no_queue", async () => {
  const { deps, chain } = watched(false);
  chain[7].status = "Paid";
  await watchApiInvoices(deps);
  assert.deepEqual(allDeliveries(deps), []);
  assert.deepEqual(deps.db.liveApiInvoices(), []);
});
