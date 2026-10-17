import type { ColumnIcon } from "./column-icons";

export const PRIORITIES = ["none", "low", "medium", "high"] as const;
export const SIZES = ["none", "xs", "s", "m", "l", "xl"] as const;

export type Priority = (typeof PRIORITIES)[number];
export type Size = (typeof SIZES)[number];

export interface Card {
  id: string;
  /** Short per-project number shown as #12; assigned by the server, never reused. */
  number: number;
  title: string;
  description: string;
  priority: Priority;
  size: Size;
  /** Who is working on the card (an agent or person's name); "" when unassigned. */
  assignee: string;
  createdAt: number;
  updatedAt: number;
}

export interface Column {
  id: string;
  name: string;
  cardIds: string[];
  /** Picked by someone; when absent the icon is worked out from the name (see column-icons.ts). */
  icon?: ColumnIcon;
  /** The server's model guess for names no rule matches, valid only while the name is unchanged. */
  guess?: { name: string; icon: ColumnIcon };
}

/** A free-form markdown page attached to a project. */
export interface ProjectDocument {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface Doc {
  initialized: boolean;
  title: string;
  description: string;
  /** Hex colour for the logo and favicon; "" on projects made before colours existed (see colors.ts). */
  color: string;
  columns: Column[];
  cards: Record<string, Card>;
  documentIds: string[];
  documents: Record<string, ProjectDocument>;
  nextCardNumber: number;
  createdAt: number;
  updatedAt: number;
}

export type CardFields = Pick<Card, "title" | "description" | "priority" | "size" | "assignee">;
export type DocumentFields = Pick<ProjectDocument, "title" | "body">;

export type Op =
  | { type: "init"; title: string; description: string; color?: string; columns: { id: string; name: string }[] }
  | { type: "updateProject"; title?: string; description?: string; color?: string }
  | { type: "addColumn"; id: string; name: string; index?: number }
  | { type: "renameColumn"; id: string; name: string }
  | { type: "moveColumn"; id: string; index: number }
  | { type: "deleteColumn"; id: string }
  /** null goes back to the automatic icon. */
  | { type: "setColumnIcon"; id: string; icon: ColumnIcon | null }
  /** Sent by the server once the model has guessed; ignored if the column was renamed meanwhile. */
  | { type: "guessColumnIcon"; id: string; name: string; icon: ColumnIcon }
  | { type: "addCard"; columnId: string; index?: number; card: { id: string } & CardFields }
  | { type: "updateCard"; id: string; patch: Partial<CardFields> }
  | { type: "moveCard"; id: string; columnId: string; index: number }
  | { type: "deleteCard"; id: string }
  /** Sets the assignee unless someone else already holds the card (pass force to take it over). */
  | { type: "claimCard"; id: string; assignee: string; force?: boolean }
  /** Adds text to the end of the description without touching what's there. */
  | { type: "appendToCard"; id: string; text: string }
  | { type: "addDocument"; document: { id: string } & DocumentFields }
  | { type: "updateDocument"; id: string; patch: Partial<DocumentFields> }
  | { type: "deleteDocument"; id: string }
  | { type: "appendToDocument"; id: string; text: string };

/** Messages sent from the browser to the project room. */
export type ClientMessage = { t: "op"; opId: string; op: Op };

/** Messages sent from the project room to browsers. */
export type ServerMessage =
  | { t: "init"; doc: Doc; version: number; peers: number }
  | { t: "reset"; doc: Doc; version: number }
  | { t: "op"; opId: string; op: Op; at: number; version: number }
  | { t: "ack"; opId: string }
  | { t: "presence"; peers: number };

export const DEFAULT_COLUMNS = ["Backlog", "In progress", "Done"];

export const LIMITS = {
  title: 200,
  name: 80,
  assignee: 60,
  description: 20_000,
  columns: 50,
  cards: 5_000,
  documents: 500,
  body: 100_000,
};
