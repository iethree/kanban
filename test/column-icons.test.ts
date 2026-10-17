import { describe, expect, test } from "bun:test";
import { columnIcon, matchColumnIcon, needsGuess } from "../src/shared/column-icons";
import { applyOp, emptyDoc } from "../src/shared/reducer";
import type { Column, Doc, Op } from "../src/shared/types";
import { exportDoc, importDoc, sanitizeOp } from "../src/shared/validate";

const col = (name: string, extra: Partial<Column> = {}): Column => ({ id: "c", name, cardIds: [], ...extra });

describe("matchColumnIcon", () => {
  test.each([
    ["Backlog", "backlog"],
    ["Icebox", "backlog"],
    ["To do", "todo"],
    ["Todo", "todo"],
    ["Up next", "todo"],
    ["In progress", "in-progress"],
    ["Doing", "in-progress"],
    ["WIP", "in-progress"],
    ["In review", "in-review"],
    ["Ready for review", "in-review"],
    ["QA", "in-review"],
    ["Done", "done"],
    ["Shipped", "done"],
    ["Cancelled", "cancelled"],
    ["Won't do", "cancelled"],
  ] as const)("%s → %s", (name, icon) => {
    expect(matchColumnIcon(name)).toBe(icon);
  });

  test("leaves names that need judgment to the model", () => {
    for (const name of ["Design", "Blocked", "With legal", "Customer"]) expect(matchColumnIcon(name)).toBeNull();
  });
});

describe("columnIcon", () => {
  test("a picked icon beats the name", () => {
    expect(columnIcon(col("Done", { icon: "cancelled" }))).toBe("cancelled");
  });

  test("uses a guess only while the name is unchanged", () => {
    const guess = { name: "With legal", icon: "in-review" as const };
    expect(columnIcon(col("With legal", { guess }))).toBe("in-review");
    expect(columnIcon(col("Legal", { guess }))).toBe("todo");
    expect(needsGuess(col("Legal", { guess }))).toBe(true);
    expect(needsGuess(col("With legal", { guess }))).toBe(false);
  });

  test("names the rules know, and picked icons, never need a guess", () => {
    expect(needsGuess(col("Done"))).toBe(false);
    expect(needsGuess(col("Blocked", { icon: "todo" }))).toBe(false);
    expect(needsGuess(col("Blocked"))).toBe(true);
  });
});

describe("icon ops", () => {
  const run = (ops: Op[], doc: Doc = emptyDoc()) => ops.reduce((d, op, i) => applyOp(d, op, 1000 + i), doc);
  const base = run([{ type: "init", title: "P", description: "", columns: [{ id: "a", name: "Legal" }] }]);

  test("setColumnIcon sets and clears the icon", () => {
    const set = run([{ type: "setColumnIcon", id: "a", icon: "done" }], base);
    expect(set.columns[0]!.icon).toBe("done");
    const cleared = run([{ type: "setColumnIcon", id: "a", icon: null }], set);
    expect("icon" in cleared.columns[0]!).toBe(false);
    expect(applyOp(cleared, { type: "setColumnIcon", id: "a", icon: null }, 0)).toBe(cleared);
  });

  test("guessColumnIcon is dropped if the column was renamed", () => {
    const renamed = run([{ type: "renameColumn", id: "a", name: "Lawyers" }], base);
    expect(applyOp(renamed, { type: "guessColumnIcon", id: "a", name: "Legal", icon: "in-review" }, 0)).toBe(renamed);
    const guessed = applyOp(base, { type: "guessColumnIcon", id: "a", name: "Legal", icon: "in-review" }, 0);
    expect(guessed.columns[0]!.guess).toEqual({ name: "Legal", icon: "in-review" });
  });

  test("sanitizeOp accepts icons, null and auto, and rejects others", () => {
    expect(sanitizeOp({ type: "setColumnIcon", id: "a", icon: "done" })).toEqual({ type: "setColumnIcon", id: "a", icon: "done" });
    expect(sanitizeOp({ type: "setColumnIcon", id: "a", icon: "auto" })).toEqual({ type: "setColumnIcon", id: "a", icon: null });
    expect(sanitizeOp({ type: "setColumnIcon", id: "a", icon: null })).toEqual({ type: "setColumnIcon", id: "a", icon: null });
    expect(sanitizeOp({ type: "setColumnIcon", id: "a", icon: "star" })).toBeNull();
    expect(sanitizeOp({ type: "guessColumnIcon", id: "a", name: "X", icon: "nope" })).toBeNull();
  });

  test("picked icons survive export and import", () => {
    const doc = run([{ type: "setColumnIcon", id: "a", icon: "in-review" }], base);
    expect(importDoc(exportDoc(doc)).columns[0]!.icon).toBe("in-review");
  });
});
