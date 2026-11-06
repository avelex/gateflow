import { expect, test } from "vitest";
import { route } from "./App.tsx";

test("route_of", () => {
  expect(route("/pay/7")).toEqual({ page: "checkout", invoice: 7 });
  expect(route("/")).toEqual({ page: "landing" });
  expect(route("/console")).toEqual({ page: "console", tab: "home" });
  expect(route("/console/invoices")).toEqual({ page: "console", tab: "invoices" });
  expect(route("/console/screening")).toEqual({ page: "console", tab: "screening" });
  expect(route("/console/balance")).toEqual({ page: "console", tab: "balance" });
  expect(route("/invoices")).toEqual({ page: "redirect" });
  expect(route("/pay/x")).toEqual({ page: "redirect" });
  expect(route("/nope")).toEqual({ page: "redirect" });
});

test("chat_route", () => {
  expect(route("/console/chat")).toEqual({ page: "console", tab: "chat" });
  expect(route("/console/chat/12")).toEqual({ page: "console", tab: "chat", thread: 12 });
  expect(route("/console/chat/x")).toEqual({ page: "redirect" });
});
