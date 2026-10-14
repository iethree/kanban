import { describe, expect, test } from "bun:test";
import { applyOp, emptyDoc } from "../src/shared/reducer";
import type { Doc, Op } from "../src/shared/types";
import { exportDoc, importDoc, sanitizeOp } from "../src/shared/validate";

const run = (ops: Op[], doc: Doc = emptyDoc()) => ops.reduce((d, op, i) => applyOp(d, op, 1000 + i), doc);

const card = (id: string, title = id) => ({ id, title, description: "", priority: "none" as const, size: "m" as const });

const base = run([
  { type: "init", title: "P", description: "", columns: [{ id: "a", name: "A" }, { id: "b", name: "B" }] },
  { type: "addCard", columnId: "a", card: card("c1") },
  { type: "addCard", columnId: "a", card: card("c2") },
  { type: "addCard", columnId: "a", card: card("c3") },
]);

const ids = (doc: Doc) => Object.fromEntries(doc.columns.map((c) => [c.id, c.cardIds]));

describe("applyOp", () => {
  test("init only applies once", () => {
    expect(base.initialized).toBe(true);
    const again = applyOp(base, { type: "init", title: "X", description: "", columns: [] }, 0);
    expect(again).toBe(base);
  });

  test("ops before init are ignored", () => {
    const doc = emptyDoc();
    expect(applyOp(doc, { type: "addColumn", id: "x", name: "X" }, 0)).toBe(doc);
  });

  test("reorders within a column", () => {
    expect(ids(run([{ type: "moveCard", id: "c1", columnId: "a", index: 2 }], base)).a).toEqual(["c2", "c3", "c1"]);
    expect(ids(run([{ type: "moveCard", id: "c3", columnId: "a", index: 0 }], base)).a).toEqual(["c3", "c1", "c2"]);
  });

  test("moves between columns", () => {
    const doc = run([{ type: "moveCard", id: "c2", columnId: "b", index: 0 }], base);
    expect(ids(doc)).toEqual({ a: ["c1", "c3"], b: ["c2"] });
  });

  test("moving to the current position is a no-op", () => {
    expect(applyOp(base, { type: "moveCard", id: "c2", columnId: "a", index: 1 }, 0)).toBe(base);
  });

  test("ops are idempotent so they can be safely resent", () => {
    const op: Op = { type: "addCard", columnId: "b", card: card("c4") };
    const once = run([op], base);
    expect(run([op], once)).toBe(once);
    const move: Op = { type: "moveCard", id: "c1", columnId: "b", index: 0 };
    expect(ids(run([move, move], base))).toEqual(ids(run([move], base)));
  });

  test("deleting a column deletes its cards", () => {
    const doc = run([{ type: "deleteColumn", id: "a" }], base);
    expect(doc.columns.map((c) => c.id)).toEqual(["b"]);
    expect(Object.keys(doc.cards)).toEqual([]);
  });

  test("unchanged cards keep their identity (used for incremental persistence)", () => {
    const doc = run([{ type: "updateCard", id: "c1", patch: { priority: "high" } }], base);
    expect(doc.cards.c1!.priority).toBe("high");
    expect(doc.cards.c2).toBe(base.cards.c2);
  });

  test("moveColumn", () => {
    const doc = run([{ type: "moveColumn", id: "b", index: 0 }], base);
    expect(doc.columns.map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("sanitizeOp", () => {
  test("rejects garbage", () => {
    expect(sanitizeOp(null)).toBeNull();
    expect(sanitizeOp({ type: "nope" })).toBeNull();
    expect(sanitizeOp({ type: "updateCard", id: "c1", patch: { priority: "urgent" } })).toBeNull();
    expect(sanitizeOp({ type: "deleteCard", id: "../../etc" })).toBeNull();
  });

  test("fills card defaults and truncates long strings", () => {
    const op = sanitizeOp({ type: "addCard", columnId: "a", card: { id: "x", title: "t".repeat(1000) } });
    expect(op).toMatchObject({ type: "addCard", card: { priority: "none", size: "none", description: "" } });
    expect((op as Extract<Op, { type: "addCard" }>).card.title.length).toBe(200);
  });
});

describe("export / import", () => {
  test("round-trips", () => {
    const doc = run([{ type: "updateCard", id: "c2", patch: { size: "xl", description: "hi" } }], base);
    const back = importDoc(JSON.parse(JSON.stringify(exportDoc(doc))));
    expect(ids(back)).toEqual(ids(doc));
    expect(back.cards.c2).toMatchObject({ size: "xl", description: "hi" });
    expect(back.title).toBe("P");
  });

  test("accepts minimal hand-written files", () => {
    const doc = importDoc({ title: "Mine", columns: [{ name: "Todo", cards: [{ title: "One", priority: "high" }] }] });
    expect(doc.columns).toHaveLength(1);
    const [c] = Object.values(doc.cards);
    expect(c).toMatchObject({ title: "One", priority: "high", size: "none" });
  });

  test("rejects malformed files", () => {
    expect(() => importDoc([])).toThrow();
    expect(() => importDoc({ project: { columns: "nope" } })).toThrow();
  });
});

describe("documents", () => {
  const withDocs = run(
    [
      { type: "addDocument", document: { id: "d1", title: "Spec", body: "# Spec" } },
      { type: "addDocument", document: { id: "d2", title: "Notes", body: "" } },
    ],
    base,
  );

  test("add, update and delete", () => {
    expect(withDocs.documentIds).toEqual(["d1", "d2"]);
    const updated = run([{ type: "updateDocument", id: "d2", patch: { body: "- [ ] todo" } }], withDocs);
    expect(updated.documents.d2!.body).toBe("- [ ] todo");
    expect(updated.documents.d1).toBe(withDocs.documents.d1);
    const deleted = run([{ type: "deleteDocument", id: "d1" }], updated);
    expect(deleted.documentIds).toEqual(["d2"]);
    expect(deleted.documents.d1).toBeUndefined();
  });

  test("adding the same document twice is a no-op", () => {
    expect(run([{ type: "addDocument", document: { id: "d1", title: "X", body: "" } }], withDocs)).toBe(withDocs);
  });

  test("round-trip through export, and old exports without documents still import", () => {
    const back = importDoc(JSON.parse(JSON.stringify(exportDoc(withDocs))));
    expect(back.documentIds).toEqual(["d1", "d2"]);
    expect(back.documents.d1).toMatchObject({ title: "Spec", body: "# Spec" });
    expect(importDoc({ columns: [] }).documentIds).toEqual([]);
  });

  test("sanitizeOp validates document ops", () => {
    expect(sanitizeOp({ type: "addDocument", document: { id: "x" } })).toEqual({
      type: "addDocument",
      document: { id: "x", title: "", body: "" },
    });
    expect(sanitizeOp({ type: "updateDocument", id: "x", patch: { body: 5 } })).toBeNull();
  });
});

test("moveCard without an index moves to the bottom", () => {
  const op = sanitizeOp({ type: "moveCard", id: "c1", columnId: "a" })!;
  expect(ids(run([op], base)).a).toEqual(["c2", "c3", "c1"]);
});
