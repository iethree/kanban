import type { Card } from "../../shared/types";

export interface AssigneeSuggestion {
  name: string;
  /** How many of the project's cards are assigned to this name. */
  count: number;
}

/**
 * Everyone assigned to a card in the project, most-used first, filtered by
 * what's been typed: names starting with the query come before names that
 * merely contain it.
 */
export function assigneeSuggestions(cards: Record<string, Card>, query: string, limit = 8): AssigneeSuggestion[] {
  const counts = new Map<string, number>();
  for (const card of Object.values(cards)) {
    const name = card.assignee.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const q = query.trim().toLowerCase();
  const rank = (name: string) => {
    if (!q) return 0;
    const lower = name.toLowerCase();
    if (lower.startsWith(q)) return 0;
    return lower.includes(q) ? 1 : -1;
  };
  return [...counts]
    .map(([name, count]) => ({ name, count, rank: rank(name) }))
    .filter((s) => s.rank >= 0)
    .sort((a, b) => a.rank - b.rank || b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ name, count }) => ({ name, count }));
}
