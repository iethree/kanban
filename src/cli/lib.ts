/**
 * Pure helpers for the kanban CLI: argument parsing, project/card/column
 * resolution and output formatting. Kept free of I/O so it can be unit tested.
 */
import { toProjectUuid, toShortId } from "../shared/ids";
import { PRIORITIES, SIZES, type Card, type Priority, type Size } from "../shared/types";
import { parseProjectPath, projectPath } from "../shared/urls";
import type { ExportedProject } from "../shared/validate";

export class CliError extends Error {
  constructor(
    message: string,
    /** 1 error, 2 bad usage, 3 card claimed by someone else. */
    public exitCode = 1,
  ) {
    super(message);
  }
}

// -- arguments ----------------------------------------------------------------

export interface Args {
  _: string[];
  flags: Record<string, string | true>;
}

const BOOLEAN_FLAGS = new Set(["json", "force", "help", "version", "no-save", "yes"]);

export function parseArgs(argv: string[]): Args {
  const args: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      args._.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "-h") {
      args.flags.help = true;
    } else if (arg === "-v") {
      args.flags.version = true;
    } else if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const key = arg.slice(2, eq === -1 ? undefined : eq);
      if (eq !== -1) args.flags[key] = arg.slice(eq + 1);
      else if (BOOLEAN_FLAGS.has(key)) args.flags[key] = true;
      else {
        const value = argv[++i];
        if (value === undefined) throw new CliError(`--${key} needs a value`, 2);
        args.flags[key] = value;
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
}

export function flag(args: Args, name: string): string | undefined {
  const v = args.flags[name];
  return typeof v === "string" ? v : undefined;
}

export function parsePriority(value: string): Priority {
  const v = value.toLowerCase() as Priority;
  if (!PRIORITIES.includes(v)) throw new CliError(`Priority must be one of: ${PRIORITIES.join(", ")}`, 2);
  return v;
}

export function parseSize(value: string): Size {
  const v = value.toLowerCase() as Size;
  if (!SIZES.includes(v)) throw new CliError(`Size must be one of: ${SIZES.join(", ")}`, 2);
  return v;
}

// -- projects -----------------------------------------------------------------

export interface ProjectRef {
  origin: string;
  /** Short (base62) project id. */
  id: string;
}

/** Accepts a page URL, an API URL, a short id or a UUID. */
export function parseProjectRef(ref: string, defaultOrigin: string): ProjectRef {
  const value = ref.trim();
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    const api = url.pathname.match(/^\/api\/p\/([^/]+)/);
    const uuid = api ? toProjectUuid(api[1]!) : parseProjectPath(url.pathname)?.id;
    if (!uuid) throw new CliError(`Couldn't find a project id in ${value}`, 2);
    return { origin: url.origin, id: toShortId(uuid) };
  }
  const uuid = toProjectUuid(value);
  if (!uuid) throw new CliError(`"${value}" isn't a project URL or id`, 2);
  return { origin: defaultOrigin.replace(/\/+$/, ""), id: toShortId(uuid) };
}

export const pageUrl = (ref: ProjectRef, title: string, suffix = "") =>
  `${ref.origin}${projectPath(ref.id, title, suffix)}`;

// -- board lookups ------------------------------------------------------------

type ExportedColumn = ExportedProject["project"]["columns"][number];
export type BoardCard = Card & { column: ExportedColumn };

export function boardCards(board: ExportedProject): BoardCard[] {
  return board.project.columns.flatMap((column) => column.cards.map((card) => ({ ...card, column })));
}

/** A card by number (12, #12) or id. */
export function findCard(board: ExportedProject, ref: string): BoardCard {
  const cards = boardCards(board);
  const num = ref.match(/^#?(\d+)$/);
  const card = num ? cards.find((c) => c.number === Number(num[1])) : cards.find((c) => c.id === ref);
  if (!card) throw new CliError(`No card ${num ? `#${num[1]}` : `"${ref}"`}. Run \`kanban board\` to see card numbers.`);
  return card;
}

/** Normalizes "12" / "#12" to the number the API accepts, or passes a card id through. */
export function cardRef(ref: string | undefined): number | string {
  if (!ref) throw new CliError("Which card? Pass its number, e.g. 12 or #12.", 2);
  const num = ref.match(/^#?(\d+)$/);
  return num ? Number(num[1]) : ref;
}

/** A column by exact name (case-insensitive), or by a prefix that matches only one column. */
export function findColumn(board: ExportedProject, name: string): ExportedColumn {
  const columns = board.project.columns;
  const wanted = name.trim().toLowerCase();
  const exact = columns.find((c) => c.name.trim().toLowerCase() === wanted);
  if (exact) return exact;
  const partial = columns.filter((c) => c.name.toLowerCase().startsWith(wanted));
  if (partial.length === 1) return partial[0]!;
  throw new CliError(`No column "${name}". Columns: ${columns.map((c) => c.name).join(", ")}`, 2);
}

function columnLike(board: ExportedProject, pattern: RegExp, fallback: (cols: ExportedColumn[]) => ExportedColumn | undefined) {
  const columns = board.project.columns;
  const column = columns.find((c) => pattern.test(c.name)) ?? fallback(columns);
  if (!column) throw new CliError("This project has no columns.");
  return column;
}

/** Where `start` moves cards: a column named like "In progress"/"Doing", else the second column. */
export const progressColumn = (board: ExportedProject) =>
  columnLike(board, /progress|doing|active|working|wip|started/i, (cols) => cols[1] ?? cols[0]);

/** Where `done` moves cards: a column named like "Done"/"Complete", else the last column. */
export const doneColumn = (board: ExportedProject) =>
  columnLike(board, /\b(done|complete|completed|finished|shipped|closed|released)\b/i, (cols) => cols.at(-1));

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2, none: 3 };

/** The highest-priority unclaimed card in a column (board order breaks ties). */
export function nextCard(column: ExportedColumn): Card | undefined {
  return column.cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => !card.assignee)
    .sort((a, b) => PRIORITY_RANK[a.card.priority] - PRIORITY_RANK[b.card.priority] || a.index - b.index)[0]?.card;
}

export function findDocument(board: ExportedProject, ref: string) {
  const docs = board.project.documents;
  const wanted = ref.trim().toLowerCase();
  return (
    docs.find((d) => d.id === ref) ??
    docs.find((d) => d.title.trim().toLowerCase() === wanted) ??
    (() => {
      const partial = docs.filter((d) => d.title.toLowerCase().startsWith(wanted));
      return partial.length === 1 ? partial[0] : undefined;
    })()
  );
}

// -- formatting ---------------------------------------------------------------

export function cardLine(card: Card): string {
  const tags = [card.priority !== "none" ? card.priority : "", card.size !== "none" ? card.size.toUpperCase() : ""].filter(Boolean);
  return [`#${card.number} ${card.title || "(untitled)"}`, tags.length ? `[${tags.join(", ")}]` : "", card.assignee ? `@${card.assignee}` : ""]
    .filter(Boolean)
    .join("  ");
}

export function formatBoard(board: ExportedProject, ref: ProjectRef): string {
  const { project } = board;
  const lines = [`${project.title || "Untitled project"}  ${pageUrl(ref, project.title)}`];
  for (const column of project.columns) {
    lines.push("", `${column.name} (${column.cards.length})`);
    lines.push(...(column.cards.length ? column.cards.map((c) => `  ${cardLine(c)}`) : ["  (empty)"]));
  }
  const docs = project.documents;
  lines.push("", docs.length ? `Documents: ${docs.map((d) => d.title || "Untitled").join(" · ")}` : "Documents: none");
  return lines.join("\n");
}

export const timestamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export function formatCard(card: BoardCard, ref: ProjectRef, projectTitle: string): string {
  return [
    `#${card.number} ${card.title || "(untitled)"}`,
    `Status:   ${card.column.name}`,
    `Priority: ${card.priority}`,
    `Size:     ${card.size}`,
    `Assignee: ${card.assignee || "(unassigned)"}`,
    `Updated:  ${timestamp(card.updatedAt)}`,
    `URL:      ${pageUrl(ref, projectTitle)}?card=${card.id}`,
    "",
    card.description || "(no description)",
  ].join("\n");
}

/** A progress note appended to a card: "**2026-10-15 14:03 UTC · claude:** text". */
export function logEntry(text: string, who: string, now = Date.now(), label = ""): string {
  const body = text.trim();
  const head = `**${timestamp(now)} · ${who}${label ? ` — ${label}` : ""}:**`;
  return body.includes("\n") ? `${head}\n\n${body}` : `${head} ${body}`;
}

export function helpText(origin: string): string {
  return `kanban — plan and track work on a shared Kanban board (${origin})

Typical loop:  kanban next → kanban start 12 → kanban log 12 "…" → kanban done 12 "…"

Setup
  kanban new <title> [--columns "Backlog,In progress,Done"]   Create a project and link this directory
  kanban init <project-url>                                   Link this directory to an existing project
  kanban url                                                  Print the project's web address for humans

Reading
  kanban board                  Columns and cards: #number title [priority, size] @assignee
  kanban show <card>            One card, including its description
  kanban next [--column C]      Highest-priority unclaimed card in the first column (or C)
  kanban docs                   List documents
  kanban doc <title|id>         Print a document's Markdown

Working on cards
  kanban add <title> [--column C] [--priority P] [--size S] [--description TEXT|-]
  kanban start <card> [--force] Claim the card and move it to the top of the in-progress column
  kanban log <card> <text|->    Append a timestamped progress note to the card's description
  kanban done <card> [summary]  Append the summary and move the card to the done column
  kanban move <card> <column>   Move to the top of another column
  kanban update <card> [--title T] [--priority P] [--size S] [--assignee NAME] [--description TEXT|-]
  kanban claim <card> [--force] Mark yourself as working on it, without moving it
  kanban release <card>         Clear the assignee
  kanban delete <card> --yes

Documents
  kanban doc write <title> [file|-]    Create or replace a document
  kanban doc append <title> <text|->   Append to a document (creates it if missing)

Cards are numbers (12 or #12). Priority: ${PRIORITIES.join("|")}. Size: ${SIZES.join("|")}.
Column and document names match case-insensitively; a unique prefix is enough.
Text arguments can be "-" to read from stdin. Descriptions and documents are Markdown.

Options
  --json           JSON output for board, show, next, docs and doc
  --as NAME        Who you are, for claims and log entries
                   (default: $KANBAN_AGENT, "agent" in .kanban, then your username)
  --project REF    Project URL or id (default: $KANBAN_PROJECT, then the nearest .kanban file)

Exit codes: 0 ok, 1 error, 2 bad usage, 3 card already claimed by someone else.
Update: curl -fsSL ${origin}/install | sh     API reference: ${origin}/llms.txt`;
}
