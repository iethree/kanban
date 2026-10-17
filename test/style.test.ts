import { describe, expect, test } from "bun:test";
import { cardLine, findCard, formatBoard, formatCard, helpText } from "../src/cli/lib";
import { colorEnabled, createStyle, plain, success } from "../src/cli/style";
import { exportDoc, importDoc } from "../src/shared/validate";

const color = createStyle(true);
const strip = (s: string) => s.replace(/\x1b\[\d+m/g, "");
const ref = { origin: "https://k.example", id: "1pv7XjjQP9gM4BRBqypgrb" };
const board = exportDoc(
  importDoc({
    title: "Demo",
    columns: [
      { name: "Backlog", cards: [{ title: "urgent", priority: "high", size: "s", assignee: "claude" }, { title: "later" }] },
      { name: "Done", cards: [] },
    ],
    documents: [{ title: "Plan", body: "x" }],
  }),
);

describe("colorEnabled", () => {
  test("only colors terminals by default", () => {
    expect(colorEnabled({}, true, {})).toBe(true);
    expect(colorEnabled({}, false, {})).toBe(false);
    expect(colorEnabled({}, undefined, {})).toBe(false);
    expect(colorEnabled({}, true, { TERM: "dumb" })).toBe(false);
  });
  test("NO_COLOR and FORCE_COLOR", () => {
    expect(colorEnabled({}, true, { NO_COLOR: "1" })).toBe(false);
    expect(colorEnabled({}, false, { FORCE_COLOR: "1" })).toBe(true);
    expect(colorEnabled({}, true, { FORCE_COLOR: "0" })).toBe(false);
  });
  test("flags win over the environment", () => {
    expect(colorEnabled({ "no-color": true }, true, { FORCE_COLOR: "1" })).toBe(false);
    expect(colorEnabled({ color: true }, false, { NO_COLOR: "1" })).toBe(true);
  });
});

describe("styled output", () => {
  test("plain style adds no escape codes", () => {
    const text = formatBoard(board, ref, plain) + helpText(ref.origin, plain);
    expect(text).not.toContain("\x1b[");
  });

  test("color only decorates: stripping it gives exactly the plain text", () => {
    const card = findCard(board, "1");
    expect(strip(cardLine(card, color))).toBe(cardLine(card));
    expect(strip(formatBoard(board, ref, color))).toBe(formatBoard(board, ref));
    expect(strip(formatCard(card, ref, "Demo", color))).toBe(formatCard(card, ref, "Demo"));
    expect(strip(helpText(ref.origin, color))).toBe(helpText(ref.origin));
  });

  test("priorities and assignees are colored", () => {
    const line = cardLine(findCard(board, "1"), color);
    expect(line).toContain("\x1b[31mhigh\x1b[39m");
    expect(line).toContain("\x1b[36m@claude\x1b[39m");
  });

  test("success marks only appear with color", () => {
    expect(success(plain, "done")).toBe("done");
    expect(strip(success(color, "done"))).toBe("✓ done");
  });
});
