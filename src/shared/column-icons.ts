import type { Column } from "./types";

/**
 * Status icons a column can show, in workflow order. Shapes and colours come
 * from escherize/lll (MIT): a dashed ring, an empty ring, a quarter and a
 * three-quarter pie, then filled check and cross discs.
 */
export const COLUMN_ICONS = ["backlog", "todo", "in-progress", "in-review", "done", "cancelled"] as const;
export type ColumnIcon = (typeof COLUMN_ICONS)[number];

export const COLUMN_ICON_LABEL: Record<ColumnIcon, string> = {
  backlog: "Backlog",
  todo: "To do",
  "in-progress": "In progress",
  "in-review": "In review",
  done: "Done",
  cancelled: "Cancelled",
};

/** Shown when nothing else decides, e.g. before a prediction arrives. */
export const FALLBACK_ICON: ColumnIcon = "todo";

export const isColumnIcon = (v: unknown): v is ColumnIcon => COLUMN_ICONS.includes(v as ColumnIcon);

// Checked in order, so "Ready for review" is a review column and not a to-do one.
const RULES: [ColumnIcon, RegExp][] = [
  ["cancelled", /\b(cancel+ed|cancel|abandoned|won'?t (do|fix)|wontfix|rejected|declined|dropped|archived?)\b/i],
  ["done", /\b(done|complete[d]?|finished|shipped|released|deployed|closed|resolved|merged)\b/i],
  ["in-review", /\b(review(ing)?|qa|testing|verif(y|ying|ication)|approval)\b/i],
  ["in-progress", /\b(in[ -]?progress|doing|wip|working|active|ongoing|in development|building)\b/i],
  ["todo", /\b(to[ -]?do|next|up next|ready|planned|selected|this week|today)\b/i],
  ["backlog", /\b(backlog|icebox|ideas?|someday|later|inbox|triage|wishlist|parking lot)\b/i],
];

/** The icon a column name obviously implies, or null when it takes judgment. */
export function matchColumnIcon(name: string): ColumnIcon | null {
  for (const [icon, re] of RULES) if (re.test(name)) return icon;
  return null;
}

/** Whether the server should ask the model about this column. */
export function needsGuess(column: Column): boolean {
  return !column.icon && !!column.name.trim() && !matchColumnIcon(column.name) && column.guess?.name !== column.name;
}

/**
 * The icon to show: the one someone picked, else what the name says, else the
 * model's guess (only while the column still has the name it guessed for).
 */
export function columnIcon(column: Column): ColumnIcon {
  return (
    column.icon ??
    matchColumnIcon(column.name) ??
    (column.guess?.name === column.name ? column.guess.icon : null) ??
    FALLBACK_ICON
  );
}
