import { describe, expect, test } from "bun:test";
import { isProjectId, toProjectUuid, toShortId } from "../src/shared/ids";

const UUID = "3c5f5d83-d805-4e41-bba5-7a69e0ea588b";
const SHORT = "1pv7XjjQP9gM4BRBqypgrb";

describe("project ids", () => {
  test("encodes a UUID as 22 base62 characters and back", () => {
    expect(toShortId(UUID)).toBe(SHORT);
    expect(toProjectUuid(SHORT)).toBe(UUID);
  });

  test("round-trips random UUIDs", () => {
    for (let i = 0; i < 2000; i++) {
      const uuid = crypto.randomUUID();
      const short = toShortId(uuid);
      expect(short).toMatch(/^[0-9A-Za-z]{22}$/);
      expect(toProjectUuid(short)).toBe(uuid);
    }
  });

  test("pads the smallest and handles the largest 128-bit values", () => {
    const zero = "00000000-0000-0000-0000-000000000000";
    const max = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    expect(toShortId(zero)).toBe("0".repeat(22));
    expect(toProjectUuid(toShortId(zero))).toBe(zero);
    expect(toProjectUuid(toShortId(max))).toBe(max);
  });

  test("UUIDs are accepted in any case and normalized; short ids are case-sensitive", () => {
    expect(toProjectUuid(UUID.toUpperCase())).toBe(UUID);
    expect(toShortId(UUID.toUpperCase())).toBe(SHORT);
    expect(toProjectUuid(SHORT.toLowerCase())).not.toBe(UUID);
  });

  test("rejects invalid ids", () => {
    expect(isProjectId("z".repeat(22))).toBe(false); // above 2^128
    expect(isProjectId(SHORT.slice(1))).toBe(false);
    expect(isProjectId(`${SHORT}x`)).toBe(false);
    expect(isProjectId("1pv7XjjQP9gM4BRBqypg-b")).toBe(false);
    expect(isProjectId("not-a-uuid")).toBe(false);
  });
});
