import type { Card, Column, Doc, Op, Priority, Size } from "./types";

/** A card as it was when something happened to it, so the feed reads right after renames and deletes. */
export interface CardRef {
  id: string;
  number: number;
  title: string;
}

/** A column by id and the name it had at the time. */
export interface ColumnRef {
  id: string;
  name: string;
}

export type CardChanges = {
  title?: [string, string];
  priority?: [Priority, Priority];
  size?: [Size, Size];
  assignee?: [string, string];
  description?: true;
};

export type ActivityEvent =
  | { kind: "project.created"; title: string }
  | { kind: "project.renamed"; from: string; to: string }
  | { kind: "project.imported"; title: string }
  | { kind: "column.added"; column: ColumnRef }
  | { kind: "column.renamed"; column: ColumnRef; from: string }
  | { kind: "column.deleted"; column: ColumnRef; cards: number }
  | { kind: "card.created"; card: CardRef; to: ColumnRef }
  | { kind: "card.moved"; card: CardRef; from: ColumnRef; to: ColumnRef }
  | { kind: "card.edited"; card: CardRef; changes: CardChanges }
  | { kind: "card.claimed"; card: CardRef; assignee: string }
  | { kind: "card.noted"; card: CardRef; text: string }
  | { kind: "card.deleted"; card: CardRef; from?: ColumnRef }
  | { kind: "document.created"; document: { id: string; title: string } }
  | { kind: "document.edited"; document: { id: string; title: string } }
  | { kind: "document.deleted"; document: { id: string; title: string } };

/**
 * Who made a change: "user" for edits made in the browser app, "agent" for
 * edits made through the HTTP API (the CLI, scripts, AI agents).
 */
export type Actor = "user" | "agent";

/**
 * One row of a project's activity feed. `seq` increases; an entry keeps its seq
 * when later edits merge into it. `user` is missing on entries recorded before
 * attribution existed.
 */
export type ActivityEntry = ActivityEvent & { seq: number; at: number; user?: Actor };

/** Edits to the same card or document this close together become one entry. */
export const MERGE_WINDOW_MS = 10 * 60 * 1000;

const NOTE_EXCERPT = 280;

const cardRef = (card: Card): CardRef => ({ id: card.id, number: card.number, title: card.title });
const columnRef = (column: Column): ColumnRef => ({ id: column.id, name: column.name });
const columnOf = (doc: Doc, cardId: string) => doc.columns.find((c) => c.cardIds.includes(cardId));

/**
 * What an applied op means for the activity feed, worked out from the
 * documents before and after it. Returns nothing for ops that change only
 * presentation (column order, icons, colours, card order within a column).
 */
export function describeOp(prev: Doc, next: Doc, op: Op): ActivityEvent[] {
  if (prev === next) return [];
  switch (op.type) {
    case "init":
      return [{ kind: "project.created", title: next.title }];

    case "updateProject":
      return op.title !== undefined && prev.title !== next.title
        ? [{ kind: "project.renamed", from: prev.title, to: next.title }]
        : [];

    case "addColumn": {
      const column = next.columns.find((c) => c.id === op.id);
      return column ? [{ kind: "column.added", column: columnRef(column) }] : [];
    }

    case "renameColumn": {
      const before = prev.columns.find((c) => c.id === op.id);
      const after = next.columns.find((c) => c.id === op.id);
      return before && after && before.name !== after.name
        ? [{ kind: "column.renamed", column: columnRef(after), from: before.name }]
        : [];
    }

    case "deleteColumn": {
      const column = prev.columns.find((c) => c.id === op.id);
      return column ? [{ kind: "column.deleted", column: columnRef(column), cards: column.cardIds.length }] : [];
    }

    case "addCard": {
      const card = next.cards[op.card.id];
      const column = columnOf(next, op.card.id);
      return card && column ? [{ kind: "card.created", card: cardRef(card), to: columnRef(column) }] : [];
    }

    case "moveCard": {
      const card = next.cards[op.id];
      const from = columnOf(prev, op.id);
      const to = columnOf(next, op.id);
      return card && from && to && from.id !== to.id
        ? [{ kind: "card.moved", card: cardRef(card), from: columnRef(from), to: columnRef(to) }]
        : [];
    }

    case "updateCard": {
      const before = prev.cards[op.id];
      const after = next.cards[op.id];
      if (!before || !after) return [];
      const changes: CardChanges = {};
      if (before.title !== after.title) changes.title = [before.title, after.title];
      if (before.priority !== after.priority) changes.priority = [before.priority, after.priority];
      if (before.size !== after.size) changes.size = [before.size, after.size];
      if (before.assignee !== after.assignee) changes.assignee = [before.assignee, after.assignee];
      if (before.description !== after.description) changes.description = true;
      return Object.keys(changes).length ? [{ kind: "card.edited", card: cardRef(after), changes }] : [];
    }

    case "claimCard": {
      const card = next.cards[op.id];
      return card ? [{ kind: "card.claimed", card: cardRef(card), assignee: card.assignee }] : [];
    }

    case "appendToCard": {
      const card = next.cards[op.id];
      const text = op.text.trim();
      if (!card || !text) return [];
      return [{ kind: "card.noted", card: cardRef(card), text: text.length > NOTE_EXCERPT ? `${text.slice(0, NOTE_EXCERPT - 1)}…` : text }];
    }

    case "deleteCard": {
      const card = prev.cards[op.id];
      const from = columnOf(prev, op.id);
      return card ? [{ kind: "card.deleted", card: cardRef(card), ...(from ? { from: columnRef(from) } : {}) }] : [];
    }

    case "addDocument": {
      const d = next.documents[op.document.id];
      return d ? [{ kind: "document.created", document: { id: d.id, title: d.title } }] : [];
    }

    case "updateDocument":
    case "appendToDocument": {
      const d = next.documents[op.id];
      return d ? [{ kind: "document.edited", document: { id: d.id, title: d.title } }] : [];
    }

    case "deleteDocument": {
      const d = prev.documents[op.id];
      return d ? [{ kind: "document.deleted", document: { id: d.id, title: d.title } }] : [];
    }

    case "moveColumn":
    case "setColumnIcon":
    case "guessColumnIcon":
      return [];
  }
}

/**
 * Folds a new edit into the previous entry when both edit the same card or
 * document within MERGE_WINDOW_MS and were made by the same actor, so typing
 * in a description doesn't flood the feed. Returns the merged entry, or null
 * if they should stay separate.
 */
export function mergeActivity(last: ActivityEntry, event: ActivityEvent, at: number, user?: Actor): ActivityEntry | null {
  if (at - last.at > MERGE_WINDOW_MS) return null;
  // A person's edit and an agent's edit stay separate so each is attributed correctly.
  if (last.user !== user) return null;
  if (last.kind === "card.edited" && event.kind === "card.edited" && last.card.id === event.card.id) {
    const changes: CardChanges = { ...last.changes };
    for (const key of ["title", "priority", "size", "assignee"] as const) {
      const change = event.changes[key];
      if (!change) continue;
      // Keep the oldest "before" so the entry spans the whole burst of edits.
      const before = (last.changes[key]?.[0] ?? change[0]) as never;
      if (before === change[1]) delete changes[key];
      else changes[key] = [before, change[1]] as never;
    }
    if (event.changes.description) changes.description = true;
    return { ...last, card: event.card, changes, at };
  }
  if (last.kind === "document.edited" && event.kind === "document.edited" && last.document.id === event.document.id) {
    return { ...last, document: event.document, at };
  }
  return null;
}
