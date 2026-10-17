import { describe, expect, test } from "bun:test";
import { MERGE_WINDOW_MS, describeOp, mergeActivity, type ActivityEntry } from "../src/shared/activity";
import { applyOp, emptyDoc } from "../src/shared/reducer";
import type { Doc, Op } from "../src/shared/types";

const card = (id: string, title = id) => ({ id, title, description: "", priority: "none" as const, size: "none" as const, assignee: "" });

/** Applies ops in turn and collects what each one would add to the feed. */
function feed(ops: Op[], doc: Doc = emptyDoc()) {
  const events = [];
  for (const op of ops) {
    const next = applyOp(doc, op, 1000);
    events.push(...describeOp(doc, next, op));
    doc = next;
  }
  return { doc, events };
}

const { doc: base } = feed([
  { type: "init", title: "P", description: "", columns: [{ id: "a", name: "Backlog" }, { id: "b", name: "Done" }] },
  { type: "addCard", columnId: "a", card: card("c1", "Write tests") },
]);

describe("describeOp", () => {
  test("project and card creation", () => {
    const { events } = feed([
      { type: "init", title: "P", description: "", columns: [{ id: "a", name: "Backlog" }] },
      { type: "addCard", columnId: "a", card: card("c1", "Write tests") },
    ]);
    expect(events).toEqual([
      { kind: "project.created", title: "P" },
      { kind: "card.created", card: { id: "c1", number: 1, title: "Write tests" }, to: { id: "a", name: "Backlog" } },
    ]);
  });

  test("moves between columns are recorded, reorders within one are not", () => {
    const { events } = feed(
      [
        { type: "addCard", columnId: "a", card: card("c2") },
        { type: "moveCard", id: "c2", columnId: "a", index: 0 },
        { type: "moveCard", id: "c1", columnId: "b", index: 0 },
      ],
      base,
    );
    expect(events.map((e) => e.kind)).toEqual(["card.created", "card.moved"]);
    expect(events[1]).toMatchObject({ from: { name: "Backlog" }, to: { name: "Done" } });
  });

  test("edits list what changed", () => {
    const { events } = feed([{ type: "updateCard", id: "c1", patch: { priority: "high", description: "x" } }], base);
    expect(events).toEqual([
      { kind: "card.edited", card: { id: "c1", number: 1, title: "Write tests" }, changes: { priority: ["none", "high"], description: true } },
    ]);
  });

  test("deletes remember what was deleted", () => {
    const { events } = feed([{ type: "deleteColumn", id: "a" }], base);
    expect(events).toEqual([{ kind: "column.deleted", column: { id: "a", name: "Backlog" }, cards: 1 }]);
  });

  test("presentation-only ops and no-ops add nothing", () => {
    const { events } = feed(
      [
        { type: "moveColumn", id: "b", index: 0 },
        { type: "setColumnIcon", id: "a", icon: "todo" },
        { type: "updateProject", color: "#386de6" },
        { type: "renameColumn", id: "a", name: "Backlog" },
      ],
      base,
    );
    expect(events).toEqual([]);
  });

  test("notes are excerpted", () => {
    const { events } = feed([{ type: "appendToCard", id: "c1", text: "x".repeat(1000) }], base);
    expect(events[0]!.kind).toBe("card.noted");
    expect((events[0] as { text: string }).text.length).toBe(280);
  });
});

describe("mergeActivity", () => {
  const edited = (changes: object, at: number, id = "c1"): ActivityEntry =>
    ({ kind: "card.edited", card: { id, number: 1, title: "T" }, changes, at, seq: 7 }) as ActivityEntry;

  test("merges edits to the same card, keeping the first before-value", () => {
    const merged = mergeActivity(edited({ priority: ["none", "low"] }, 0), edited({ priority: ["low", "high"], description: true }, 1000), 1000);
    expect(merged).toMatchObject({ seq: 7, at: 1000, changes: { priority: ["none", "high"], description: true } });
  });

  test("drops a change that was undone", () => {
    const merged = mergeActivity(edited({ priority: ["none", "low"] }, 0), edited({ priority: ["low", "none"] }, 1000), 1000);
    expect(merged!.kind === "card.edited" && merged!.changes).toEqual({});
  });

  test("keeps separate entries for other cards or after the window", () => {
    expect(mergeActivity(edited({}, 0), edited({}, 10, "c2"), 10)).toBeNull();
    expect(mergeActivity(edited({}, 0), edited({}, MERGE_WINDOW_MS + 1), MERGE_WINDOW_MS + 1)).toBeNull();
  });
});
