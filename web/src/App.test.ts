import { expect, test } from "vitest";
import { route } from "./App.tsx";

test("route_of", () => {
  expect(route("/pay/7")).toEqual({ page: "checkout", invoice: 7 });
  expect(route("/")).toEqual({ page: "console", tab: "home" });
  expect(route("/invoices")).toEqual({ page: "console", tab: "invoices" });
  expect(route("/screening")).toEqual({ page: "console", tab: "screening" });
  expect(route("/pay/x")).toEqual({ page: "redirect" });
  expect(route("/nope")).toEqual({ page: "redirect" });
});
