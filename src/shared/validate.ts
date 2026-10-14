import type { Card, CardFields, Doc, DocumentFields, Op, Priority, Size, ProjectDocument } from "./types";
import { LIMITS, PRIORITIES, SIZES } from "./types";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | undefined => (typeof v === "string" ? v.slice(0, max) : undefined);
const id = (v: unknown): string | undefined =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : undefined;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const priority = (v: unknown): Priority | undefined =>
  PRIORITIES.includes(v as Priority) ? (v as Priority) : undefined;
const size = (v: unknown): Size | undefined => (SIZES.includes(v as Size) ? (v as Size) : undefined);

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function cardPatch(raw: unknown): Partial<CardFields> | null {
  if (!isObj(raw)) return null;
  const patch: Partial<CardFields> = {};
  if ("title" in raw) {
    const v = str(raw.title, LIMITS.title);
    if (v === undefined) return null;
    patch.title = v;
  }
  if ("description" in raw) {
    const v = str(raw.description, LIMITS.description);
    if (v === undefined) return null;
    patch.description = v;
  }
  if ("priority" in raw) {
    const v = priority(raw.priority);
    if (!v) return null;
    patch.priority = v;
  }
  if ("size" in raw) {
    const v = size(raw.size);
    if (!v) return null;
    patch.size = v;
  }
  return patch;
}

function documentPatch(raw: unknown): Partial<DocumentFields> | null {
  if (!isObj(raw)) return null;
  const patch: Partial<DocumentFields> = {};
  if ("title" in raw) {
    const v = str(raw.title, LIMITS.title);
    if (v === undefined) return null;
    patch.title = v;
  }
  if ("body" in raw) {
    const v = str(raw.body, LIMITS.body);
    if (v === undefined) return null;
    patch.body = v;
  }
  return patch;
}

/** Validates and normalizes an untrusted op from a client. Returns null if invalid. */
export function sanitizeOp(raw: unknown): Op | null {
  if (!isObj(raw)) return null;
  switch (raw.type) {
    case "init": {
      const title = str(raw.title, LIMITS.title);
      const description = str(raw.description, LIMITS.description) ?? "";
      if (title === undefined || !Array.isArray(raw.columns)) return null;
      const columns: { id: string; name: string }[] = [];
      for (const c of raw.columns.slice(0, LIMITS.columns)) {
        if (!isObj(c)) return null;
        const cid = id(c.id);
        const name = str(c.name, LIMITS.name);
        if (!cid || name === undefined) return null;
        if (columns.some((x) => x.id === cid)) continue;
        columns.push({ id: cid, name });
      }
      return { type: "init", title, description, columns };
    }
    case "updateProject": {
      const op: Op = { type: "updateProject" };
      if (raw.title !== undefined) {
        op.title = str(raw.title, LIMITS.title);
        if (op.title === undefined) return null;
      }
      if (raw.description !== undefined) {
        op.description = str(raw.description, LIMITS.description);
        if (op.description === undefined) return null;
      }
      return op;
    }
    case "addColumn": {
      const cid = id(raw.id);
      const name = str(raw.name, LIMITS.name);
      if (!cid || name === undefined) return null;
      return { type: "addColumn", id: cid, name, index: num(raw.index) };
    }
    case "renameColumn": {
      const cid = id(raw.id);
      const name = str(raw.name, LIMITS.name);
      if (!cid || name === undefined) return null;
      return { type: "renameColumn", id: cid, name };
    }
    case "moveColumn": {
      const cid = id(raw.id);
      const index = num(raw.index);
      if (!cid || index === undefined) return null;
      return { type: "moveColumn", id: cid, index };
    }
    case "deleteColumn": {
      const cid = id(raw.id);
      return cid ? { type: "deleteColumn", id: cid } : null;
    }
    case "addCard": {
      const columnId = id(raw.columnId);
      if (!columnId || !isObj(raw.card)) return null;
      const cardId = id(raw.card.id);
      const patch = cardPatch(raw.card);
      if (!cardId || !patch) return null;
      return {
        type: "addCard",
        columnId,
        index: num(raw.index),
        card: {
          id: cardId,
          title: patch.title ?? "",
          description: patch.description ?? "",
          priority: patch.priority ?? "none",
          size: patch.size ?? "none",
        },
      };
    }
    case "updateCard": {
      const cardId = id(raw.id);
      const patch = cardPatch(raw.patch);
      if (!cardId || !patch) return null;
      return { type: "updateCard", id: cardId, patch };
    }
    case "moveCard": {
      const cardId = id(raw.id);
      const columnId = id(raw.columnId);
      // Omitting the index moves the card to the bottom of the column.
      const index = num(raw.index) ?? LIMITS.cards;
      if (!cardId || !columnId) return null;
      return { type: "moveCard", id: cardId, columnId, index };
    }
    case "deleteCard": {
      const cardId = id(raw.id);
      return cardId ? { type: "deleteCard", id: cardId } : null;
    }
    case "addDocument": {
      if (!isObj(raw.document)) return null;
      const docId = id(raw.document.id);
      const patch = documentPatch(raw.document);
      if (!docId || !patch) return null;
      return { type: "addDocument", document: { id: docId, title: patch.title ?? "", body: patch.body ?? "" } };
    }
    case "updateDocument": {
      const docId = id(raw.id);
      const patch = documentPatch(raw.patch);
      if (!docId || !patch) return null;
      return { type: "updateDocument", id: docId, patch };
    }
    case "deleteDocument": {
      const docId = id(raw.id);
      return docId ? { type: "deleteDocument", id: docId } : null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Export / import

export const EXPORT_KIND = "kanban-project";

export interface ExportedProject {
  kind: typeof EXPORT_KIND;
  version: 1;
  exportedAt: string;
  project: {
    title: string;
    description: string;
    createdAt: number;
    updatedAt: number;
    columns: {
      id: string;
      name: string;
      cards: Card[];
    }[];
    documents: ProjectDocument[];
  };
}

export function exportDoc(doc: Doc): ExportedProject {
  return {
    kind: EXPORT_KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    project: {
      title: doc.title,
      description: doc.description,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      columns: doc.columns.map((c) => ({
        id: c.id,
        name: c.name,
        cards: c.cardIds.map((cid) => doc.cards[cid]).filter((c): c is Card => !!c),
      })),
      documents: doc.documentIds.map((id) => doc.documents[id]).filter((d): d is ProjectDocument => !!d),
    },
  };
}

/**
 * Converts an exported JSON file back into a document. Lenient about missing
 * optional fields (ids, timestamps, priority, size) so hand-written files work,
 * but throws a readable error if the overall shape is wrong.
 */
export function importDoc(raw: unknown, now = Date.now()): Doc {
  if (!isObj(raw)) throw new Error("File is not a JSON object.");
  const project = isObj(raw.project) ? raw.project : raw;
  if (!Array.isArray(project.columns)) throw new Error("Missing a `columns` array.");
  if (project.columns.length > LIMITS.columns) throw new Error(`Too many columns (max ${LIMITS.columns}).`);

  const doc: Doc = {
    initialized: true,
    title: str(project.title, LIMITS.title) ?? "Imported project",
    description: str(project.description, LIMITS.description) ?? "",
    columns: [],
    cards: {},
    documentIds: [],
    documents: {},
    createdAt: num(project.createdAt) ?? now,
    updatedAt: now,
  };

  const seenColumns = new Set<string>();
  let cardCount = 0;
  for (const rawCol of project.columns) {
    if (!isObj(rawCol)) throw new Error("Each column must be an object.");
    let colId = id(rawCol.id) ?? newId();
    if (seenColumns.has(colId)) colId = newId();
    seenColumns.add(colId);

    const cardIds: string[] = [];
    const rawCards = Array.isArray(rawCol.cards) ? rawCol.cards : [];
    for (const rawCard of rawCards) {
      if (!isObj(rawCard)) throw new Error("Each card must be an object.");
      if (++cardCount > LIMITS.cards) throw new Error(`Too many cards (max ${LIMITS.cards}).`);
      let cardId = id(rawCard.id) ?? newId();
      if (doc.cards[cardId]) cardId = newId();
      doc.cards[cardId] = {
        id: cardId,
        title: str(rawCard.title, LIMITS.title) ?? "",
        description: str(rawCard.description, LIMITS.description) ?? "",
        priority: priority(rawCard.priority) ?? "none",
        size: size(rawCard.size) ?? "none",
        createdAt: num(rawCard.createdAt) ?? now,
        updatedAt: num(rawCard.updatedAt) ?? now,
      };
      cardIds.push(cardId);
    }
    doc.columns.push({ id: colId, name: str(rawCol.name, LIMITS.name) ?? "Untitled", cardIds });
  }

  // Documents are optional so older exports still import.
  const rawDocs = Array.isArray(project.documents) ? project.documents : [];
  if (rawDocs.length > LIMITS.documents) throw new Error(`Too many documents (max ${LIMITS.documents}).`);
  for (const rawDoc of rawDocs) {
    if (!isObj(rawDoc)) throw new Error("Each document must be an object.");
    let docId = id(rawDoc.id) ?? newId();
    if (doc.documents[docId]) docId = newId();
    doc.documents[docId] = {
      id: docId,
      title: str(rawDoc.title, LIMITS.title) ?? "",
      body: str(rawDoc.body, LIMITS.body) ?? "",
      createdAt: num(rawDoc.createdAt) ?? now,
      updatedAt: num(rawDoc.updatedAt) ?? now,
    };
    doc.documentIds.push(docId);
  }
  return doc;
}
