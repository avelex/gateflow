import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import * as ds from "./ds.jsx";

const NAMES = ["Button", "Icon", "IconButton", "Badge", "Card", "Hash", "Stat", "StatusBadge", "Tag", "Dialog", "Toast", "Tooltip", "FlowSteps", "Checkbox", "Input", "Radio", "Select", "Switch", "Tabs"];

test("ds_exports_all", () => {
  for (const n of NAMES) expect(typeof (ds as Record<string, unknown>)[n], n).toBe("function");
});

test("icon_renders_lucide", () => {
  const html = renderToStaticMarkup(createElement(ds.Icon, { name: "wallet" }));
  expect(html).toContain('viewBox="0 0 24 24"');
  expect(html).toContain("<path");
});
