import { expect, test } from "bun:test";
import type { ActivityEntry } from "../src/shared/activity";
import { computeStats, startOfDay } from "../src/shared/stats";
import type { Card, Doc } from "../src/shared/types";

const DAY = 86_400_000;
const now = startOfDay(Date.UTC(2026, 9, 17, 12)) + 12 * 3_600_000;
const daysAgo = (n: number) => now - n * DAY;

const card = (id: string, number: number, createdAt: number, updatedAt = createdAt, priority: Card["priority"] = "none"): Card => ({
  id, number, title: id, description: "", priority, size: "none", assignee: "", createdAt, updatedAt,
});

const cols = { backlog: { id: "b", name: "Backlog" }, doing: { id: "p", name: "In progress" }, done: { id: "d", name: "Done" } };

function doc(placement: Record<string, string[]>, cards: Card[]): Doc {
  return {
    initialized: true, title: "P", description: "", color: "",
    columns: Object.values(cols).map((c) => ({ ...c, cardIds: placement[c.id] ?? [] })),
    cards: Object.fromEntries(cards.map((c) => [c.id, c])),
    documentIds: [], documents: {}, nextCardNumber: 10, createdAt: daysAgo(40), updatedAt: now,
  };
}

let seq = 0;
const e = (entry: object, at: number) => ({ ...entry, at, seq: ++seq }) as ActivityEntry;
const ref = (id: string, number: number) => ({ id, number, title: id });

test("burndown, throughput and lead time from the activity feed", () => {
  const d = doc({ b: ["c3"], d: ["c1", "c2"] }, [
    card("c1", 1, daysAgo(10), daysAgo(3)),
    card("c2", 2, daysAgo(8), daysAgo(1)),
    card("c3", 3, daysAgo(5), daysAgo(5), "high"),
  ]);
  const activity = [
    e({ kind: "card.created", card: ref("c1", 1), to: cols.backlog }, daysAgo(10)),
    e({ kind: "card.created", card: ref("c2", 2), to: cols.backlog }, daysAgo(8)),
    e({ kind: "card.created", card: ref("c3", 3), to: cols.backlog }, daysAgo(5)),
    e({ kind: "card.moved", card: ref("c1", 1), from: cols.backlog, to: cols.done }, daysAgo(3)),
    e({ kind: "card.moved", card: ref("c2", 2), from: cols.backlog, to: cols.done }, daysAgo(1)),
  ];
  const s = computeStats(d, activity, now, 14);
  expect(s.burndown).toHaveLength(14);
  expect(s.burndown.map((p) => p.open)).toEqual([0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 2, 2, 1, 1]);
  expect(s.open).toBe(1);
  expect(s.openAtStart).toBe(0);
  expect(s.created).toBe(3);
  expect(s.completed).toBe(2);
  expect(s.medianLeadDays).toBe(7); // 7 days each
  expect(s.buckets.reduce((n, b) => n + b.completed, 0)).toBe(2);
  expect(s.columns.map((c) => [c.name, c.count])).toEqual([["Backlog", 1], ["In progress", 0], ["Done", 2]]);
  expect(s.priorities[0]).toEqual({ priority: "high", open: 1 });
});

test("cards from before the feed use their timestamps", () => {
  const d = doc({ b: ["old"], d: ["finished"] }, [card("old", 1, daysAgo(20)), card("finished", 2, daysAgo(20), daysAgo(2))]);
  const s = computeStats(d, [], now, 14);
  expect(s.openAtStart).toBe(2);
  expect(s.burndown.at(-1)!.open).toBe(1);
  expect(s.completed).toBe(1);
});

test("deleting an open card takes it off the burndown; reopening puts it back", () => {
  const d = doc({ b: ["x"] }, [card("x", 1, daysAgo(4))]);
  const activity = [
    e({ kind: "card.created", card: ref("x", 1), to: cols.backlog }, daysAgo(4)),
    e({ kind: "card.moved", card: ref("x", 1), from: cols.backlog, to: cols.done }, daysAgo(3)),
    e({ kind: "card.moved", card: ref("x", 1), from: cols.done, to: cols.backlog }, daysAgo(2)),
    e({ kind: "card.created", card: ref("gone", 2), to: cols.backlog }, daysAgo(2)),
    e({ kind: "card.deleted", card: ref("gone", 2), from: cols.backlog }, daysAgo(1)),
  ];
  const s = computeStats(d, activity, now, 14);
  expect(s.burndown.slice(-5).map((p) => p.open)).toEqual([1, 0, 2, 1, 1]);
});

test("90-day ranges bucket by week", () => {
  const s = computeStats(doc({}, []), [], now, 90);
  expect(s.buckets.every((b) => b.days === 7)).toBe(true);
  expect(s.buckets).toHaveLength(13);
});
