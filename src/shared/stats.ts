import type { ActivityEntry, ColumnRef } from "./activity";
import { columnIcon, matchColumnIcon, type ColumnIcon } from "./column-icons";
import { PRIORITIES, type Doc, type Priority } from "./types";

const DAY = 86_400_000;

export const STAT_RANGES = [14, 30, 90] as const;
export type StatRange = (typeof STAT_RANGES)[number];

export interface Bucket {
  /** Start of the bucket (local midnight). */
  start: number;
  /** Bucket length in days: 1, or 7 for long ranges. */
  days: number;
  created: number;
  completed: number;
}

export interface Stats {
  range: StatRange;
  /** Open cards at the end of each day in the range, oldest first. */
  burndown: { day: number; open: number }[];
  buckets: Bucket[];
  open: number;
  /** Open cards when the range began, for the change shown beside `open`. */
  openAtStart: number;
  completed: number;
  completedBefore: number;
  created: number;
  /** Median days from creation to completion for cards completed in the range; null with none. */
  medianLeadDays: number | null;
  columns: { id: string; name: string; icon: ColumnIcon; count: number }[];
  priorities: { priority: Priority; open: number }[];
}

const isClosedIcon = (icon: ColumnIcon | null) => icon === "done" || icon === "cancelled";

/** Local midnight of the day containing `t`. */
export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

type CardEvent = { at: number; delta: 1 | -1; completed?: boolean };

/**
 * Works out the project's history from its activity feed plus the current
 * board. Cards from before the feed existed fall back to their timestamps:
 * created at `createdAt`, and finished at `updatedAt` if they sit in a done
 * or cancelled column now.
 */
export function computeStats(doc: Doc, activity: ActivityEntry[], now: number, range: StatRange): Stats {
  const iconOf = (ref: ColumnRef): ColumnIcon | null => {
    const column = doc.columns.find((c) => c.id === ref.id);
    return column ? columnIcon(column) : matchColumnIcon(ref.name);
  };
  const closed = (ref: ColumnRef) => isClosedIcon(iconOf(ref));
  const done = (ref: ColumnRef) => iconOf(ref) === "done";

  // Each card's +1 (opened) and -1 (closed or deleted while open) moments.
  const events: CardEvent[] = [];
  const byCard = new Map<string, ActivityEntry[]>();
  for (const entry of [...activity].sort((a, b) => a.at - b.at || a.seq - b.seq)) {
    if (entry.kind === "card.created" || entry.kind === "card.moved" || entry.kind === "card.deleted") {
      const list = byCard.get(entry.card.id) ?? [];
      list.push(entry);
      byCard.set(entry.card.id, list);
    }
  }
  const completedAt = new Map<string, number[]>();
  const createdAt = new Map<string, number>();
  const ids = new Set([...Object.keys(doc.cards), ...byCard.keys()]);

  for (const id of ids) {
    const card = doc.cards[id];
    const history = byCard.get(id) ?? [];
    const created = history.find((e) => e.kind === "card.created");
    const born = created?.at ?? card?.createdAt;
    if (born === undefined) continue; // a deleted card we never saw created
    createdAt.set(id, born);

    let open = true;
    const firstMove = history.find((e) => e.kind === "card.moved");
    if (created?.kind === "card.created") open = !closed(created.to);
    else if (firstMove?.kind === "card.moved") open = !closed(firstMove.from);
    if (open) events.push({ at: born, delta: 1 });
    else if (created?.kind === "card.created" && done(created.to)) completedAt.set(id, [born]);

    let moved = false;
    for (const e of history) {
      if (e.kind === "card.moved") {
        moved = true;
        const nowOpen = !closed(e.to);
        if (open && !nowOpen) {
          events.push({ at: e.at, delta: -1 });
          if (done(e.to)) completedAt.set(id, [...(completedAt.get(id) ?? []), e.at]);
        } else if (!open && nowOpen) {
          events.push({ at: e.at, delta: 1 });
        }
        open = nowOpen;
      } else if (e.kind === "card.deleted") {
        if (open) events.push({ at: e.at, delta: -1 });
        open = false;
      }
    }

    // A card from before the feed that is finished now: assume it finished at its last update.
    if (card && !moved && !created) {
      const column = doc.columns.find((c) => c.cardIds.includes(id));
      if (column && isClosedIcon(columnIcon(column))) {
        events.push({ at: Math.max(born, card.updatedAt), delta: -1 });
        if (columnIcon(column) === "done") completedAt.set(id, [Math.max(born, card.updatedAt)]);
      }
    }
  }
  events.sort((a, b) => a.at - b.at);
  const openAt = (t: number) => events.reduce((n, e) => (e.at <= t ? n + e.delta : n), 0);

  const today = startOfDay(now);
  const first = today - (range - 1) * DAY;
  const rangeStart = first;
  const burndown = Array.from({ length: range }, (_, i) => {
    const day = first + i * DAY;
    return { day, open: Math.max(0, openAt(i === range - 1 ? now : day + DAY - 1)) };
  });

  const span = range > 30 ? 7 : 1;
  const buckets: Bucket[] = [];
  for (let start = first; start <= today; start += span * DAY) {
    buckets.push({ start, days: span, created: 0, completed: 0 });
  }
  const bucketOf = (t: number) => buckets[Math.floor((t - first) / (span * DAY))];
  const completions = [...completedAt.entries()].flatMap(([id, times]) => times.map((at) => ({ id, at })));
  for (const at of createdAt.values()) if (at >= first) bucketOf(at) && bucketOf(at)!.created++;
  for (const { at } of completions) if (at >= first) bucketOf(at) && bucketOf(at)!.completed++;

  const inRange = completions.filter((c) => c.at >= rangeStart && c.at <= now);
  const lead = inRange
    .map((c) => (c.at - (createdAt.get(c.id) ?? c.at)) / DAY)
    .sort((a, b) => a - b);
  const medianLeadDays = lead.length
    ? lead.length % 2
      ? lead[(lead.length - 1) / 2]!
      : (lead[lead.length / 2 - 1]! + lead[lead.length / 2]!) / 2
    : null;

  const openCards = doc.columns
    .filter((c) => !isClosedIcon(columnIcon(c)))
    .flatMap((c) => c.cardIds.map((id) => doc.cards[id]).filter((card) => !!card));

  return {
    range,
    burndown,
    buckets,
    open: openCards.length,
    openAtStart: Math.max(0, openAt(rangeStart - 1)),
    completed: inRange.length,
    completedBefore: completions.filter((c) => c.at >= rangeStart - range * DAY && c.at < rangeStart).length,
    created: [...createdAt.values()].filter((at) => at >= rangeStart && at <= now).length,
    medianLeadDays,
    columns: doc.columns.map((c) => ({
      id: c.id,
      name: c.name,
      icon: columnIcon(c),
      count: c.cardIds.filter((id) => doc.cards[id]).length,
    })),
    priorities: [...PRIORITIES].reverse().map((priority) => ({
      priority,
      open: openCards.filter((card) => card.priority === priority).length,
    })),
  };
}
