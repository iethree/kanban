import { describe, expect, test } from "bun:test";
import {
  cardLine,
  cardRef,
  doneColumn,
  findCard,
  findColumn,
  logEntry,
  nextCard,
  parseArgs,
  parseProjectRef,
  progressColumn,
  todoColumn,
} from "../src/cli/lib";
import { importDoc, exportDoc } from "../src/shared/validate";

const board = exportDoc(
  importDoc({
    title: "Demo",
    columns: [
      {
        name: "Backlog",
        cards: [
          { title: "low one", priority: "low" },
          { title: "urgent", priority: "high" },
          { title: "taken", priority: "high", assignee: "codex" },
        ],
      },
      { name: "Doing", cards: [] },
      { name: "Review", cards: [] },
      { name: "Shipped", cards: [] },
    ],
  }),
);

describe("parseArgs", () => {
  test("positionals, value flags, boolean flags and --", () => {
    const args = parseArgs(["add", "Fix", "bug", "--priority", "high", "--size=s", "--json", "--", "--literal"]);
    expect(args._).toEqual(["add", "Fix", "bug", "--literal"]);
    expect(args.flags).toEqual({ priority: "high", size: "s", json: true });
  });
  test("a value flag without a value is a usage error", () => {
    expect(() => parseArgs(["add", "--column"])).toThrow("--column needs a value");
  });
});

describe("project references", () => {
  const SHORT = "1pv7XjjQP9gM4BRBqypgrb";
  test("page URLs, API URLs, short ids and UUIDs", () => {
    expect(parseProjectRef(`https://k.example/p/my-board/${SHORT}/docs`, "https://default")).toEqual({
      origin: "https://k.example",
      id: SHORT,
    });
    expect(parseProjectRef(`https://k.example/api/p/${SHORT}/llms.txt`, "https://default").id).toBe(SHORT);
    expect(parseProjectRef("3c5f5d83-d805-4e41-bba5-7a69e0ea588b", "https://default/")).toEqual({
      origin: "https://default",
      id: SHORT,
    });
    expect(() => parseProjectRef("https://k.example/p/nope", "x")).toThrow();
  });
});

describe("board lookups", () => {
  test("cards by number or #number", () => {
    expect(findCard(board, "2").title).toBe("urgent");
    expect(findCard(board, "#2").column.name).toBe("Backlog");
    expect(() => findCard(board, "#99")).toThrow("No card #99");
    expect(cardRef("#12")).toBe(12);
    expect(cardRef("abc")).toBe("abc");
  });

  test("columns by name or unique prefix", () => {
    expect(findColumn(board, "doing").name).toBe("Doing");
    expect(findColumn(board, "rev").name).toBe("Review");
    expect(() => findColumn(board, "x")).toThrow("Columns: Backlog, Doing, Review, Shipped");
  });

  test("start/done targets are found by name, with positional fallbacks", () => {
    expect(progressColumn(board).name).toBe("Doing");
    expect(doneColumn(board).name).toBe("Shipped");
    const plain = exportDoc(importDoc({ columns: [{ name: "Todo" }, { name: "Now" }, { name: "Later" }] }));
    expect(progressColumn(plain).name).toBe("Now");
    expect(doneColumn(plain).name).toBe("Later");
  });

  test("next looks in a Todo-like column, else the first", () => {
    expect(todoColumn(board).name).toBe("Backlog");
    const todo = exportDoc(importDoc({ columns: [{ name: "Backlog" }, { name: "To do" }, { name: "In progress" }] }));
    expect(todoColumn(todo).name).toBe("To do");
    const next = exportDoc(importDoc({ columns: [{ name: "Ideas" }, { name: "Up next" }] }));
    expect(todoColumn(next).name).toBe("Up next");
  });

  test("next picks the highest-priority unclaimed card", () => {
    expect(nextCard(board.project.columns[0]!)?.title).toBe("urgent");
    expect(nextCard(board.project.columns[1]!)).toBeUndefined();
  });
});

describe("formatting", () => {
  test("card lines", () => {
    expect(cardLine(findCard(board, "3"))).toBe("#3 taken  [high]  @codex");
    expect(cardLine(findCard(board, "1"))).toBe("#1 low one  [low]");
  });
  test("log entries", () => {
    const at = Date.UTC(2026, 9, 15, 14, 3);
    expect(logEntry("tests pass", "claude", at)).toBe("**2026-10-15 14:03 UTC · claude:** tests pass");
    expect(logEntry("line 1\nline 2", "claude", at, "done")).toBe(
      "**2026-10-15 14:03 UTC · claude — done:**\n\nline 1\nline 2",
    );
  });
});

describe("activity lines", () => {
  test("show who made each change", async () => {
    const { formatActivity } = await import("../src/cli/lib");
    const at = Date.UTC(2026, 9, 17, 9, 30);
    const card = { id: "c", number: 7, title: "user field" };
    const moved = { kind: "card.moved", card, from: { id: "a", name: "Backlog" }, to: { id: "b", name: "Done" }, at, seq: 1 } as const;
    expect(formatActivity({ ...moved, user: "agent" })).toBe("2026-10-17 09:30 UTC  agent  #7 user field: Backlog → Done");
    expect(formatActivity({ ...moved, user: "user" })).toBe("2026-10-17 09:30 UTC  user   #7 user field: Backlog → Done");
    expect(formatActivity(moved)).toBe("2026-10-17 09:30 UTC         #7 user field: Backlog → Done");
  });
});
