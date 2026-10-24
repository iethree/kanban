import { expect, test } from "bun:test";
import { CHECK_INTERVAL_MS, isNewer, shouldAutoCheck } from "../src/cli/update";

test("isNewer compares versions numerically", () => {
  expect(isNewer("1.4.0", "1.3.0")).toBe(true);
  expect(isNewer("1.10.0", "1.9.9")).toBe(true);
  expect(isNewer("2", "1.9")).toBe(true);
  expect(isNewer("1.3.0", "1.3.0")).toBe(false);
  expect(isNewer("1.3", "1.3.0")).toBe(false);
  expect(isNewer("1.2.9", "1.3.0")).toBe(false);
  expect(isNewer("<html>", "1.3.0")).toBe(false);
  expect(isNewer("", "1.3.0")).toBe(false);
});

test("auto-checks at most once a day, and never when turned off or in CI", () => {
  const now = 10 * CHECK_INTERVAL_MS;
  expect(shouldAutoCheck({}, null, now)).toBe(true);
  expect(shouldAutoCheck({}, now - CHECK_INTERVAL_MS, now)).toBe(true);
  expect(shouldAutoCheck({}, now - 1000, now)).toBe(false);
  expect(shouldAutoCheck({}, now + 5000, now)).toBe(true); // clock went backwards
  expect(shouldAutoCheck({ KANBAN_NO_UPDATE: "1" }, null, now)).toBe(false);
  expect(shouldAutoCheck({ CI: "true" }, null, now)).toBe(false);
});
