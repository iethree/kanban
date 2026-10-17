import { expect, test } from "bun:test";
import { assigneeSuggestions } from "../src/client/lib/assignees";
import type { Card } from "../src/shared/types";

const card = (id: string, assignee: string) =>
  ({ id, number: 1, title: id, description: "", priority: "none", size: "none", assignee, createdAt: 0, updatedAt: 0 }) as Card;
const cards = Object.fromEntries(
  [card("a", "claude"), card("b", "claude"), card("c", "ryan"), card("d", ""), card("e", "codex"), card("f", " Ana ")].map((c) => [c.id, c]),
);

test("lists everyone assigned in the project, most-used first", () => {
  expect(assigneeSuggestions(cards, "")).toEqual([
    { name: "claude", count: 2 },
    { name: "Ana", count: 1 },
    { name: "codex", count: 1 },
    { name: "ryan", count: 1 },
  ]);
});

test("filters by what's typed, prefix matches first", () => {
  expect(assigneeSuggestions(cards, "c").map((s) => s.name)).toEqual(["claude", "codex"]);
  expect(assigneeSuggestions(cards, "AN").map((s) => s.name)).toEqual(["Ana", "ryan"]);
  expect(assigneeSuggestions(cards, "zzz")).toEqual([]);
});

test("respects the limit", () => {
  expect(assigneeSuggestions(cards, "", 2)).toHaveLength(2);
});
