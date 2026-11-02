import { expect, test } from "vitest";
import { onboardingScreen } from "./logic.ts";

test("onboarding_screen", () => {
  for (const m of ["prf", "stored", null] as const) expect(onboardingScreen("account", m)).toBe("details");
  expect(onboardingScreen("tokens", null)).toBe("resume-key");
  expect(onboardingScreen("tokens", "prf")).toBe("details");
  expect(onboardingScreen("gateway", null)).toBe("resume-key");
  expect(onboardingScreen("gateway", "stored")).toBe("gateway");
  expect(onboardingScreen("done", null)).toBe("done");
});
