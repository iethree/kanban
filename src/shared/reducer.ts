import type { Card, Column, Doc, Op, ProjectDocument } from "./types";
import { LIMITS } from "./types";

export function emptyDoc(): Doc {
  return {
    initialized: false,
    title: "",
    description: "",
    color: "",
    columns: [],
    cards: {},
    documentIds: [],
    documents: {},
    nextCardNumber: 1,
    createdAt: 0,
    updatedAt: 0,
  };
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(n)));

function insertAt<T>(list: T[], item: T, index: number | undefined): T[] {
  const next = list.slice();
  next.splice(index === undefined ? next.length : clamp(index, 0, next.length), 0, item);
  return next;
}

function findColumnOfCard(doc: Doc, cardId: string): Column | undefined {
  return doc.columns.find((c) => c.cardIds.includes(cardId));
}

/** Adds a paragraph to the end of existing Markdown, separated by a blank line. */
function appendText(existing: string, text: string, max: number): string {
  const head = existing.trimEnd();
  return (head ? `${head}\n\n${text.trim()}` : text.trim()).slice(0, max);
}

/** The current assignee if a claim would take the card from someone else, otherwise null. */
export function claimConflict(card: Card, op: { assignee: string; force?: boolean }): string | null {
  return card.assignee && card.assignee !== op.assignee && !op.force ? card.assignee : null;
}

/**
 * Fills in fields added after a project was first saved: card numbers (in
 * board order, so older projects get sensible #1, #2, ...) and assignees.
 * Returns the same object if nothing needed changing.
 */
export function normalizeDoc(doc: Doc): Doc {
  const cards = Object.values(doc.cards);
  const seen = new Set<number>();
  const valid = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;
  let ok = valid(doc.nextCardNumber) && Array.isArray(doc.documentIds) && !!doc.documents;
  for (const card of cards) {
    if (!valid(card.number) || seen.has(card.number) || card.number >= doc.nextCardNumber || typeof card.assignee !== "string") {
      ok = false;
      break;
    }
    seen.add(card.number);
  }
  if (ok) return doc;

  const ordered = [...doc.columns.flatMap((c) => c.cardIds), ...Object.keys(doc.cards)];
  const taken = new Set<number>();
  const keep = new Set<string>();
  for (const id of ordered) {
    const n = doc.cards[id]?.number;
    if (!keep.has(id) && valid(n) && !taken.has(n)) {
      taken.add(n);
      keep.add(id);
    }
  }
  let next = Math.max(0, ...taken) + 1;
  const fixed: Record<string, Card> = {};
  for (const id of ordered) {
    const card = doc.cards[id];
    if (!card || fixed[id]) continue;
    fixed[id] = { ...card, number: keep.has(id) ? card.number : next++, assignee: typeof card.assignee === "string" ? card.assignee : "" };
  }
  return {
    ...doc,
    color: doc.color ?? "",
    documentIds: doc.documentIds ?? [],
    documents: doc.documents ?? {},
    cards: fixed,
    nextCardNumber: Math.max(next, valid(doc.nextCardNumber) ? doc.nextCardNumber : 1),
  };
}

/**
 * Applies an operation to a document, returning a new document (or the same
 * reference if the op was a no-op). Pure and deterministic so the server and
 * every client converge on the same state. Ops are idempotent where possible,
 * so a client may safely resend unacknowledged ops after reconnecting.
 */
export function applyOp(doc: Doc, op: Op, now: number): Doc {
  if (op.type === "init") {
    if (doc.initialized) return doc;
    return {
      initialized: true,
      title: op.title,
      description: op.description,
      color: op.color ?? "",
      columns: op.columns.map((c) => ({ id: c.id, name: c.name, cardIds: [] })),
      cards: {},
      documentIds: [],
      documents: {},
      nextCardNumber: 1,
      createdAt: now,
      updatedAt: now,
    };
  }
  if (!doc.initialized) return doc;

  const touch = (next: Partial<Doc>): Doc => ({ ...doc, ...next, updatedAt: now });

  switch (op.type) {
    case "updateProject": {
      const next: Partial<Doc> = {};
      if (op.title !== undefined) next.title = op.title;
      if (op.description !== undefined) next.description = op.description;
      if (op.color !== undefined) next.color = op.color;
      return touch(next);
    }

    case "addColumn": {
      if (doc.columns.length >= LIMITS.columns) return doc;
      if (doc.columns.some((c) => c.id === op.id)) return doc;
      return touch({ columns: insertAt(doc.columns, { id: op.id, name: op.name, cardIds: [] }, op.index) });
    }

    case "renameColumn": {
      if (!doc.columns.some((c) => c.id === op.id)) return doc;
      return touch({ columns: doc.columns.map((c) => (c.id === op.id ? { ...c, name: op.name } : c)) });
    }

    case "setColumnIcon": {
      const col = doc.columns.find((c) => c.id === op.id);
      if (!col || (col.icon ?? null) === op.icon) return doc;
      const { icon: _, ...rest } = col;
      const next = op.icon ? { ...rest, icon: op.icon } : rest;
      return touch({ columns: doc.columns.map((c) => (c === col ? next : c)) });
    }

    case "guessColumnIcon": {
      const col = doc.columns.find((c) => c.id === op.id);
      if (!col || col.name !== op.name || (col.guess?.name === op.name && col.guess.icon === op.icon)) return doc;
      const guess = { name: op.name, icon: op.icon };
      return { ...doc, columns: doc.columns.map((c) => (c === col ? { ...c, guess } : c)) };
    }

    case "moveColumn": {
      const col = doc.columns.find((c) => c.id === op.id);
      if (!col) return doc;
      const rest = doc.columns.filter((c) => c.id !== op.id);
      return touch({ columns: insertAt(rest, col, op.index) });
    }

    case "deleteColumn": {
      const col = doc.columns.find((c) => c.id === op.id);
      if (!col) return doc;
      const cards = { ...doc.cards };
      for (const id of col.cardIds) delete cards[id];
      return touch({ columns: doc.columns.filter((c) => c.id !== op.id), cards });
    }

    case "addCard": {
      if (doc.cards[op.card.id]) return doc;
      if (Object.keys(doc.cards).length >= LIMITS.cards) return doc;
      const col = doc.columns.find((c) => c.id === op.columnId);
      if (!col) return doc;
      const card: Card = { ...op.card, number: doc.nextCardNumber, createdAt: now, updatedAt: now };
      return touch({
        cards: { ...doc.cards, [card.id]: card },
        columns: doc.columns.map((c) => (c === col ? { ...c, cardIds: insertAt(c.cardIds, card.id, op.index) } : c)),
        nextCardNumber: doc.nextCardNumber + 1,
      });
    }

    case "claimCard": {
      const card = doc.cards[op.id];
      if (!card || card.assignee === op.assignee) return doc;
      if (claimConflict(card, op)) return doc;
      return touch({ cards: { ...doc.cards, [op.id]: { ...card, assignee: op.assignee, updatedAt: now } } });
    }

    case "appendToCard": {
      const card = doc.cards[op.id];
      if (!card || !op.text.trim()) return doc;
      const description = appendText(card.description, op.text, LIMITS.description);
      return touch({ cards: { ...doc.cards, [op.id]: { ...card, description, updatedAt: now } } });
    }

    case "updateCard": {
      const card = doc.cards[op.id];
      if (!card) return doc;
      return touch({ cards: { ...doc.cards, [op.id]: { ...card, ...op.patch, updatedAt: now } } });
    }

    case "moveCard": {
      const card = doc.cards[op.id];
      const from = findColumnOfCard(doc, op.id);
      const to = doc.columns.find((c) => c.id === op.columnId);
      if (!card || !from || !to) return doc;
      const currentIndex = from.cardIds.indexOf(op.id);
      if (from === to && currentIndex === clamp(op.index, 0, from.cardIds.length - 1)) return doc;
      const columns = doc.columns.map((c) => {
        let ids = c.cardIds;
        if (c === from) ids = ids.filter((id) => id !== op.id);
        if (c === to) ids = insertAt(ids, op.id, op.index);
        return ids === c.cardIds ? c : { ...c, cardIds: ids };
      });
      const cards = from === to ? doc.cards : { ...doc.cards, [op.id]: { ...card, updatedAt: now } };
      return touch({ columns, cards });
    }

    case "deleteCard": {
      if (!doc.cards[op.id]) return doc;
      const cards = { ...doc.cards };
      delete cards[op.id];
      return touch({
        cards,
        columns: doc.columns.map((c) => (c.cardIds.includes(op.id) ? { ...c, cardIds: c.cardIds.filter((id) => id !== op.id) } : c)),
      });
    }

    case "addDocument": {
      if (doc.documents[op.document.id]) return doc;
      if (doc.documentIds.length >= LIMITS.documents) return doc;
      const document: ProjectDocument = { ...op.document, createdAt: now, updatedAt: now };
      return touch({
        documents: { ...doc.documents, [document.id]: document },
        documentIds: [...doc.documentIds, document.id],
      });
    }

    case "updateDocument": {
      const document = doc.documents[op.id];
      if (!document) return doc;
      return touch({ documents: { ...doc.documents, [op.id]: { ...document, ...op.patch, updatedAt: now } } });
    }

    case "appendToDocument": {
      const document = doc.documents[op.id];
      if (!document || !op.text.trim()) return doc;
      const body = appendText(document.body, op.text, LIMITS.body);
      return touch({ documents: { ...doc.documents, [op.id]: { ...document, body, updatedAt: now } } });
    }

    case "deleteDocument": {
      if (!doc.documents[op.id]) return doc;
      const documents = { ...doc.documents };
      delete documents[op.id];
      return touch({ documents, documentIds: doc.documentIds.filter((id) => id !== op.id) });
    }
  }
}
