/**
 * Pure helpers for the kban CLI: argument parsing, project/card/column
 * resolution and output formatting. Kept free of I/O so it can be unit tested.
 */
import type { ActivityEntry } from "../shared/activity";
import { currentUrl } from "../shared/domains";
import { toProjectUuid, toShortId } from "../shared/ids";
import { PRIORITIES, SIZES, type Card, type Priority, type Size } from "../shared/types";
import { parseProjectPath, projectPath } from "../shared/urls";
import type { ExportedProject } from "../shared/validate";
import { column as columnName, link, num, person, plain, priority as priorityText, type Style } from "./style";

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

const BOOLEAN_FLAGS = new Set(["json", "force", "help", "version", "no-save", "yes", "color", "no-color", "local", "print"]);

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

/**
 * A setting from the environment: `KBAN_<name>`, or `KANBAN_<name>` from before the CLI was renamed to kban.
 */
export function envSetting(env: Record<string, string | undefined>, name: string): string | undefined {
  return env[`KBAN_${name}`] || env[`KANBAN_${name}`] || undefined;
}

// -- projects -----------------------------------------------------------------

export interface ProjectRef {
  origin: string;
  /** Short (base62) project id. */
  id: string;
  /** Key for a protected project. */
  key?: string;
}

/** Accepts a page URL, an API URL, a short id or a UUID. URLs on a host the app moved from point at its new one. */
export function parseProjectRef(ref: string, defaultOrigin: string): ProjectRef {
  const value = ref.trim();
  if (/^https?:\/\//i.test(value)) {
    const url = currentUrl(new URL(value));
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
  if (!card) throw new CliError(`No card ${num ? `#${num[1]}` : `"${ref}"`}. Run \`kban board\` to see card numbers.`);
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

/** Where `next` looks for work: a column named like "Todo"/"Next"/"Ready", else the first column. */
export const todoColumn = (board: ExportedProject) =>
  columnLike(board, /\b(to[ -]?do|next|up next|ready|selected)\b/i, (cols) => cols[0]);

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

export function cardLine(card: Card, s: Style = plain): string {
  const tags = [
    card.priority !== "none" ? priorityText(s, card.priority) : "",
    card.size !== "none" ? card.size.toUpperCase() : "",
  ].filter(Boolean);
  return [
    `${num(s, card.number)} ${card.title || s.dim("(untitled)")}`,
    tags.length ? `${s.dim("[")}${tags.join(s.dim(", "))}${s.dim("]")}` : "",
    card.assignee ? person(s, `@${card.assignee}`) : "",
  ]
    .filter(Boolean)
    .join("  ");
}

export function formatBoard(board: ExportedProject, ref: ProjectRef, s: Style = plain): string {
  const { project } = board;
  const lines = [`${s.bold(project.title || "Untitled project")}  ${link(s, pageUrl(ref, project.title))}`];
  for (const column of project.columns) {
    lines.push("", `${columnName(s, column.name)} ${s.dim(`(${column.cards.length})`)}`);
    lines.push(...(column.cards.length ? column.cards.map((c) => `  ${cardLine(c, s)}`) : [`  ${s.dim("(empty)")}`]));
  }
  const docs = project.documents;
  lines.push("", `${s.dim("Documents:")} ${docs.length ? docs.map((d) => d.title || "Untitled").join(s.dim(" · ")) : s.dim("none")}`);
  return lines.join("\n");
}

export const timestamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export function formatCard(card: BoardCard, ref: ProjectRef, projectTitle: string, s: Style = plain): string {
  const label = (text: string) => s.dim(text.padEnd(10));
  return [
    `${num(s, card.number)} ${s.bold(card.title || "(untitled)")}`,
    `${label("Status:")}${columnName(s, card.column.name)}`,
    `${label("Priority:")}${priorityText(s, card.priority)}`,
    `${label("Size:")}${card.size === "none" ? s.dim("none") : card.size}`,
    `${label("Assignee:")}${card.assignee ? person(s, card.assignee) : s.dim("(unassigned)")}`,
    `${label("Updated:")}${timestamp(card.updatedAt)}`,
    `${label("URL:")}${link(s, `${pageUrl(ref, projectTitle)}?card=${card.id}`)}`,
    "",
    card.description || s.dim("(no description)"),
  ].join("\n");
}

/** One feed entry as a line: "2026-10-15 14:03 UTC  agent  #12 Fix login: Backlog → In progress". */
export function formatActivity(e: ActivityEntry, s: Style = plain): string {
  const card = (c: { number: number; title: string }) => `${num(s, c.number)} ${c.title || "Untitled"}`;
  const what = (() => {
    switch (e.kind) {
      case "project.created":
        return `project created: ${e.title}`;
      case "project.renamed":
        return `project renamed: ${e.from} → ${e.to}`;
      case "project.imported":
        return `project replaced by an import of ${e.title}`;
      case "column.added":
        return `column added: ${columnName(s, e.column.name)}`;
      case "column.renamed":
        return `column renamed: ${columnName(s, e.from)} → ${columnName(s, e.column.name)}`;
      case "column.deleted":
        return `column deleted: ${columnName(s, e.column.name)} (${e.cards} card${e.cards === 1 ? "" : "s"})`;
      case "card.created":
        return `${card(e.card)}: created in ${columnName(s, e.to.name)}`;
      case "card.moved":
        return `${card(e.card)}: ${columnName(s, e.from.name)} → ${columnName(s, e.to.name)}`;
      case "card.edited": {
        const fields = Object.keys(e.changes);
        return `${card(e.card)}: edited${fields.length ? ` ${fields.join(", ")}` : ""}`;
      }
      case "card.claimed":
        return `${card(e.card)}: claimed by ${person(s, e.assignee)}`;
      case "card.noted":
        return `${card(e.card)}: note — ${e.text.replace(/\s+/g, " ")}`;
      case "card.deleted":
        return `${card(e.card)}: deleted`;
      case "document.created":
      case "document.edited":
      case "document.deleted":
        return `document ${e.kind.split(".")[1]}: ${e.document.title || "Untitled"}`;
    }
  })();
  // Who made the change; blank for entries recorded before attribution existed.
  const who = (e.user ?? "").padEnd(5);
  return `${s.dim(timestamp(e.at))}  ${e.user === "agent" ? s.cyan(who) : s.dim(who)}  ${what}`;
}

/** A progress note appended to a card: "**2026-10-15 14:03 UTC · claude:** text". */
export function logEntry(text: string, who: string, now = Date.now(), label = ""): string {
  const body = text.trim();
  const head = `**${timestamp(now)} · ${who}${label ? ` — ${label}` : ""}:**`;
  return body.includes("\n") ? `${head}\n\n${body}` : `${head} ${body}`;
}

/**
 * Help, colored by line shape so the text itself stays the single source:
 * section headings bold, commands cyan, and option/flag names cyan.
 */
export function helpText(origin: string, s: Style = plain): string {
  if (!s.enabled) return helpBody(origin);
  return helpBody(origin)
    .split("\n")
    .map((line, i) => {
      if (i === 0) return line.replace(/^kban/, s.bold("kban"));
      if (/^[A-Z][A-Za-z ]+$/.test(line)) return s.bold(line); // section heading
      const command = line.match(/^(\s+)(kban \S.*?)(\s{2,}.*)?$/);
      if (command) return `${command[1]}${s.cyan(command[2]!)}${command[3] ?? ""}`;
      const option = line.match(/^(\s+)(--\S+(?: \S+)?)(\s{2,}.*)$/);
      if (option) return `${option[1]}${s.cyan(option[2]!)}${option[3]}`;
      if (/^(Typical loop|Exit codes|Update):?/.test(line)) return line.replace(/^([^:]+:)/, s.bold("$1"));
      return line;
    })
    .join("\n");
}

const HELP_COLUMN = 34;

/** "  command    description", aligned; long commands put the description on the next line. */
function helpRow(command: string, description = ""): string {
  if (!description) return `  ${command}`;
  if (command.length + 2 <= HELP_COLUMN) return `  ${command.padEnd(HELP_COLUMN)}${description}`;
  return `  ${command}\n  ${" ".repeat(HELP_COLUMN)}${description}`;
}

function helpBody(origin: string): string {
  const section = (title: string, rows: [string, string?][]) =>
    [title, ...rows.map(([command, description]) => helpRow(command, description))].join("\n");

  return [
    `kban — plan and track work on a shared kanban board (${origin})`,
    "",
    `Typical loop:  kban next → kban start 12 → kban log 12 "…" → kban done 12 "…"`,
    "",
    section("Setup", [
      ["kban new <title> [--columns A,B,C]", "Create a project and link this directory"],
      ["kban init <project-url> [--key K]", "Link this directory to an existing project (and its key)"],
      ["kban url", "Print the project's web address for humans"],
    ]),
    "",
    section("Reading", [
      ["kban board", "Columns and cards: #number title [priority, size] @assignee"],
      ["kban show <card>", "One card, including its description"],
      ["kban next [--column C]", "Highest-priority unclaimed card in the Todo column (or C)"],
      ["kban activity [--limit N]", "What changed lately: moves, claims, edits, notes (default 20)"],
      ["kban docs", "List documents"],
      ["kban doc <title|id>", "Print a document's Markdown"],
    ]),
    "",
    section("Working on cards", [
      ["kban add <title> [--column C] [--priority P] [--size S] [--description TEXT|-]", "Add a card"],
      ["kban start <card> [--force]", "Claim the card and move it to the top of the in-progress column"],
      ["kban log <card> <text|->", "Append a timestamped progress note to the card's description"],
      ["kban done <card> [summary]", "Append the summary and move the card to the done column"],
      ["kban move <card> <column>", "Move to the top of another column"],
      ["kban update <card> [--title T] [--priority P] [--size S] [--assignee NAME] [--description TEXT|-]", "Change fields"],
      ["kban claim <card> [--force]", "Mark yourself as working on it, without moving it"],
      ["kban release <card>", "Clear the assignee"],
      ["kban delete <card> --yes", "Delete a card"],
    ]),
    "",
    section("Documents", [
      ["kban doc write <title> [file|-]", "Create or replace a document"],
      ["kban doc append <title> <text|->", "Append to a document (creates it if missing)"],
    ]),
    "",
    section("Keys (a protected project needs a key as well as its link)", [
      ["kban keys", "List the project's keys"],
      ["kban keys add", "Create a key. The first one protects the project and is saved in .kban"],
      ["kban keys revoke <id|first characters>", "Revoke a key (not the one you're using)"],
      ["kban access [none|read-only]", "Show or set what people without a key can do"],
    ]),
    "",
    section("Claude Code", [
      ["kban install-skill [--local] [--print]", "Add /kban next, which works through the Todo column"],
    ]),
    "",
    section("Updates", [
      ["kban upgrade", "Update the CLI to the latest version now. It also checks by itself once a day."],
    ]),
    "",
    `Cards are numbers (12 or #12). Priority: ${PRIORITIES.join("|")}. Size: ${SIZES.join("|")}.`,
    "Column and document names match case-insensitively; a unique prefix is enough.",
    'Text arguments can be "-" to read from stdin. Descriptions and documents are Markdown.',
    "",
    "Options",
    "  --json           JSON output for board, show, next, docs and doc",
    "  --as NAME        Who you are, for claims and log entries",
    '                   (default: $KBAN_AGENT, "agent" in .kban, then your username)',
    "  --project REF    Project URL or id (default: $KBAN_PROJECT, then the nearest .kban file)",
    '  --key KEY        Key for a protected project (default: $KBAN_KEY, then "key" in .kban)',
    "  --no-color       Plain output (also: NO_COLOR=1). Color is only used in a terminal.",
    "  KBAN_NO_UPDATE=1    Don't check for updates (also off when CI is set)",
    "",
    "kban used to be called kanban: the kanban command, .kanban files and KANBAN_* variables still work.",
    "",
    "Exit codes: 0 ok, 1 error, 2 bad usage, 3 card already claimed by someone else.",
    `Update: curl -fsSL ${origin}/install | sh     API reference: ${origin}/llms.txt`,
  ].join("\n");
}
