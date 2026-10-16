/**
 * kanban — a command-line client for Kanban projects, aimed at AI agents (and
 * humans) planning and tracking work from a terminal. It is served by the app
 * itself at /kanban.js and installed with `curl -fsSL <origin>/install | sh`.
 * It only uses the public HTTP API documented at /llms.txt. Node 18+ or Bun.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { toShortId } from "../shared/ids";
import { DEFAULT_COLUMNS, LIMITS } from "../shared/types";
import type { ExportedProject } from "../shared/validate";
import {
  CliError,
  cardRef,
  doneColumn,
  findCard,
  findColumn,
  findDocument,
  flag,
  formatBoard,
  formatCard,
  helpText,
  logEntry,
  nextCard,
  pageUrl,
  parseArgs,
  parsePriority,
  parseProjectRef,
  parseSize,
  progressColumn,
  type Args,
  type ProjectRef,
} from "./lib";

const VERSION = "1.0.0";
const CONFIG_FILE = ".kanban";

// The server replaces this placeholder with its own origin when serving the script.
const SERVED_FROM: string = "__KANBAN_ORIGIN__";
const DEFAULT_ORIGIN =
  process.env.KANBAN_ORIGIN || (SERVED_FROM.startsWith("http") ? SERVED_FROM : "https://kanban.infopanel.org");

interface Config {
  project: string;
  agent?: string;
}

interface OpsResult {
  ok: true;
  url: string;
  results: { type: string; id?: string; number?: number; changed: boolean }[];
}

// -- config -------------------------------------------------------------------

function findConfig(start = process.cwd()): { path: string; config: Config } | null {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    const path = join(dir, CONFIG_FILE);
    if (existsSync(path)) {
      try {
        return { path, config: JSON.parse(readFileSync(path, "utf8")) };
      } catch {
        throw new CliError(`${path} isn't valid JSON. Re-create it with \`kanban init <project-url>\`.`);
      }
    }
    if (dirname(dir) === dir) return null;
  }
}

function writeConfig(config: Config): string {
  const path = join(process.cwd(), CONFIG_FILE);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
}

function projectFor(args: Args): ProjectRef {
  const ref = flag(args, "project") ?? process.env.KANBAN_PROJECT ?? findConfig()?.config.project;
  if (!ref) {
    throw new CliError(
      "No project linked here. Run `kanban init <project-url>` to link an existing project, or `kanban new <title>` to create one.",
      2,
    );
  }
  return parseProjectRef(ref, DEFAULT_ORIGIN);
}

function agentName(args: Args): string {
  const fromConfig = (() => {
    try {
      return findConfig()?.config.agent;
    } catch {
      return undefined;
    }
  })();
  const name = flag(args, "as") ?? process.env.KANBAN_AGENT ?? fromConfig ?? safeUsername();
  return name.trim().slice(0, LIMITS.assignee) || "agent";
}

function safeUsername() {
  try {
    return userInfo().username;
  } catch {
    return "agent";
  }
}

// -- I/O ----------------------------------------------------------------------

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Text from arguments, "-" for stdin, or piped stdin when no arguments are given. */
async function requiredText(parts: string[], what: string): Promise<string> {
  let text = "";
  if (parts.length === 1 && parts[0] === "-") text = await readStdin();
  else if (parts.length) text = parts.join(" ");
  else if (!process.stdin.isTTY) text = await readStdin();
  if (!text.trim()) throw new CliError(`Missing ${what}. Pass it as an argument, or "-" to read stdin.`, 2);
  return text;
}

async function optionalText(parts: string[]): Promise<string> {
  if (parts.length === 1 && parts[0] === "-") return readStdin();
  return parts.join(" ");
}

async function flagText(args: Args, name: string): Promise<string | undefined> {
  const value = flag(args, name);
  return value === "-" ? readStdin() : value;
}

const out = (text: string): void => {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
};
const json = (value: unknown) => out(JSON.stringify(value, null, 2));

// -- API ----------------------------------------------------------------------

class Api {
  constructor(readonly ref: ProjectRef) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.ref.origin}/api/p/${this.ref.id}${path}`, {
        ...init,
        headers: { "User-Agent": `kanban-cli/${VERSION}`, ...init?.headers },
      });
    } catch (err) {
      throw new CliError(`Couldn't reach ${this.ref.origin}: ${err instanceof Error ? err.message : err}`);
    }
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {}
    if (!res.ok) {
      const message = (body as { error?: string })?.error ?? `HTTP ${res.status}`;
      throw new CliError(message, res.status === 409 ? 3 : 1);
    }
    return body as T;
  }

  board = () => this.request<ExportedProject>("");

  ops = (ops: unknown[]) =>
    this.request<OpsResult>("/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ops }),
    });
}

/** Rewords the API's claim conflict (409) in CLI terms. */
function claimError(err: unknown, card: string | number): never {
  if (err instanceof CliError && err.exitCode === 3) {
    const holder = err.message.match(/claimed by "([^"]+)"/)?.[1] ?? "someone else";
    throw new CliError(
      `#${String(card).replace("#", "")} is already claimed by ${holder}. Pick another card (kanban next), or add --force to take it over.`,
      3,
    );
  }
  throw err;
}

// -- commands -----------------------------------------------------------------

type Command = (args: Args, rest: string[]) => Promise<void>;

const commands: Record<string, Command> = {
  async new(args, rest) {
    const title = rest.join(" ").trim();
    if (!title) throw new CliError('Give the project a title: kanban new "My project"', 2);
    const columns = (flag(args, "columns") ?? DEFAULT_COLUMNS.join(","))
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    const ref: ProjectRef = { origin: (flag(args, "origin") ?? DEFAULT_ORIGIN).replace(/\/+$/, ""), id: toShortId(randomUUID()) };
    const res = await new Api(ref).ops([
      { type: "init", title, description: (await flagText(args, "description")) ?? "", columns },
    ]);
    if (!args.flags["no-save"]) {
      const path = writeConfig({ project: res.url });
      out(`Created "${title}" and linked it in ${path}`);
    } else {
      out(`Created "${title}"`);
    }
    out(res.url);
    out("Anyone with this link can view and edit the board. Share it with your human; don't commit .kanban to a public repository.");
  },

  async init(args, rest) {
    const target = rest[0];
    if (!target) throw new CliError("Usage: kanban init <project-url>", 2);
    const ref = parseProjectRef(target, DEFAULT_ORIGIN);
    const board = await new Api(ref).board().catch((err: CliError) => {
      throw new CliError(`${err.message} Check the link, or create a project with \`kanban new <title>\`.`);
    });
    const url = pageUrl(ref, board.project.title);
    const agent = flag(args, "as");
    const path = writeConfig({ project: url, ...(agent ? { agent } : {}) });
    out(`Linked ${path} to "${board.project.title}"`);
    out(url);
    out("Anyone with this link can view and edit the board; don't commit .kanban to a public repository.");
  },

  async url(args) {
    const ref = projectFor(args);
    const board = await new Api(ref).board();
    out(pageUrl(ref, board.project.title));
  },

  async board(args) {
    const ref = projectFor(args);
    const board = await new Api(ref).board();
    if (args.flags.json) return json(board);
    out(formatBoard(board, ref));
  },

  async show(args, rest) {
    const ref = projectFor(args);
    const board = await new Api(ref).board();
    const card = findCard(board, String(cardRef(rest[0])));
    if (args.flags.json) {
      const { column, ...rest } = card;
      return json({ ...rest, status: column.name, columnId: column.id });
    }
    out(formatCard(card, ref, board.project.title));
  },

  async next(args) {
    const ref = projectFor(args);
    const board = await new Api(ref).board();
    const column = flag(args, "column") ? findColumn(board, flag(args, "column")!) : board.project.columns[0];
    if (!column) throw new CliError("This project has no columns.");
    const card = column && nextCard(column);
    if (args.flags.json) return json(card ? { ...card, status: column.name } : null);
    if (!card) return out(`No unclaimed cards in ${column.name}.`);
    out(formatCard({ ...card, column }, ref, board.project.title));
    out(`\nStart it with: kanban start ${card.number}`);
  },

  async add(args, rest) {
    const title = rest.join(" ").trim();
    if (!title) throw new CliError('Usage: kanban add "Card title" [--column C] [--priority P] [--size S]', 2);
    const ref = projectFor(args);
    const api = new Api(ref);
    const board = await api.board();
    const column = flag(args, "column") ? findColumn(board, flag(args, "column")!) : board.project.columns[0];
    if (!column) throw new CliError("This project has no columns.");
    const card = {
      title,
      description: (await flagText(args, "description")) ?? "",
      priority: flag(args, "priority") ? parsePriority(flag(args, "priority")!) : "none",
      size: flag(args, "size") ? parseSize(flag(args, "size")!) : "none",
      assignee: flag(args, "assignee") ?? "",
    };
    const res = await api.ops([{ type: "addCard", columnId: column.id, card }]);
    out(`#${res.results[0]?.number} added to ${column.name}: ${title}`);
  },

  async start(args, rest) {
    const ref = projectFor(args);
    const api = new Api(ref);
    const board = await api.board();
    const card = findCard(board, String(cardRef(rest[0])));
    const target = flag(args, "column") ? findColumn(board, flag(args, "column")!) : progressColumn(board);
    const who = agentName(args);
    // One request, so the claim and the move succeed or fail together.
    await api
      .ops([
        { type: "claimCard", id: card.id, assignee: who, force: args.flags.force === true },
        { type: "moveCard", id: card.id, columnId: target.id, index: 0 },
      ])
      .catch((err) => claimError(err, card.number));
    out(`#${card.number} ${card.title} → ${target.name} (claimed by ${who})`);
  },

  async log(args, rest) {
    const ref = projectFor(args);
    const id = cardRef(rest[0]);
    const text = await requiredText(rest.slice(1), "the note to log");
    const res = await new Api(ref).ops([{ type: "appendToCard", id, text: logEntry(text, agentName(args)) }]);
    out(`Logged on #${res.results[0]?.number}`);
  },

  async done(args, rest) {
    const ref = projectFor(args);
    const api = new Api(ref);
    const board = await api.board();
    const card = findCard(board, String(cardRef(rest[0])));
    const target = flag(args, "column") ? findColumn(board, flag(args, "column")!) : doneColumn(board);
    const summary = await optionalText(rest.slice(1));
    const ops: unknown[] = [];
    if (summary.trim()) ops.push({ type: "appendToCard", id: card.id, text: logEntry(summary, agentName(args), Date.now(), "done") });
    ops.push({ type: "moveCard", id: card.id, columnId: target.id, index: 0 });
    await api.ops(ops);
    out(`#${card.number} ${card.title} → ${target.name}`);
  },

  async move(args, rest) {
    const ref = projectFor(args);
    const api = new Api(ref);
    const board = await api.board();
    const card = findCard(board, String(cardRef(rest[0])));
    const name = rest.slice(1).join(" ");
    if (!name) throw new CliError("Usage: kanban move <card> <column>", 2);
    const target = findColumn(board, name);
    await api.ops([{ type: "moveCard", id: card.id, columnId: target.id, index: 0 }]);
    out(`#${card.number} ${card.title} → ${target.name}`);
  },

  async update(args, rest) {
    const ref = projectFor(args);
    const id = cardRef(rest[0]);
    const patch: Record<string, string> = {};
    if (flag(args, "title") !== undefined) patch.title = flag(args, "title")!;
    if (flag(args, "priority")) patch.priority = parsePriority(flag(args, "priority")!);
    if (flag(args, "size")) patch.size = parseSize(flag(args, "size")!);
    if (flag(args, "assignee") !== undefined) patch.assignee = flag(args, "assignee")!;
    const description = await flagText(args, "description");
    if (description !== undefined) patch.description = description;
    if (!Object.keys(patch).length) {
      throw new CliError("Nothing to update. Use --title, --priority, --size, --assignee or --description.", 2);
    }
    const res = await new Api(ref).ops([{ type: "updateCard", id, patch }]);
    out(`Updated #${res.results[0]?.number}`);
  },

  async claim(args, rest) {
    const ref = projectFor(args);
    const who = agentName(args);
    const id = cardRef(rest[0]);
    const res = await new Api(ref)
      .ops([{ type: "claimCard", id, assignee: who, force: args.flags.force === true }])
      .catch((err) => claimError(err, id));
    out(`#${res.results[0]?.number} claimed by ${who}`);
  },

  async release(args, rest) {
    const ref = projectFor(args);
    const res = await new Api(ref).ops([{ type: "updateCard", id: cardRef(rest[0]), patch: { assignee: "" } }]);
    out(`#${res.results[0]?.number} is unassigned`);
  },

  async delete(args, rest) {
    const id = cardRef(rest[0]);
    if (!args.flags.yes) throw new CliError(`This permanently deletes the card. Re-run with --yes: kanban delete ${rest[0]} --yes`, 2);
    const ref = projectFor(args);
    const board = await new Api(ref).board();
    const card = findCard(board, String(id));
    await new Api(ref).ops([{ type: "deleteCard", id: card.id }]);
    out(`Deleted #${card.number} ${card.title}`);
  },

  async docs(args) {
    const ref = projectFor(args);
    const board = await new Api(ref).board();
    const docs = board.project.documents;
    if (args.flags.json) return json(docs.map(({ body, ...d }) => ({ ...d, length: body.length })));
    if (!docs.length) return out('No documents. Create one with: kanban doc write "Title" notes.md');
    out(docs.map((d) => `${d.id}  ${d.title || "Untitled"}  (${d.body.length} chars)`).join("\n"));
  },

  async doc(args, rest) {
    const [sub, ...more] = rest;
    if (sub === "write" || sub === "append") return docWrite(args, sub, more);
    if (!sub) throw new CliError("Usage: kanban doc <title|id>, kanban doc write <title> [file|-], kanban doc append <title> <text|->", 2);
    const ref = projectFor(args);
    const board = await new Api(ref).board();
    const doc = findDocument(board, rest.join(" "));
    if (!doc) throw new CliError(`No document "${rest.join(" ")}". Run \`kanban docs\` to list them.`);
    if (args.flags.json) return json(doc);
    out(doc.body || "(empty document)");
  },

  async whoami(args) {
    out(`${agentName(args)} on ${(() => {
      try {
        const ref = projectFor(args);
        return `${ref.origin}/p/${ref.id}`;
      } catch {
        return "(no project linked)";
      }
    })()}`);
  },
};

async function docWrite(args: Args, mode: "write" | "append", rest: string[]) {
  const title = rest[0];
  if (!title) throw new CliError(`Usage: kanban doc ${mode} <title> ${mode === "write" ? "[file|-]" : "<text|->"}`, 2);
  const ref = projectFor(args);
  const api = new Api(ref);
  const board = await api.board();
  const existing = findDocument(board, title);

  let text: string;
  if (mode === "write") {
    const source = rest[1];
    if (source && source !== "-") {
      if (!existsSync(source)) throw new CliError(`No such file: ${source}`, 2);
      text = readFileSync(source, "utf8");
    } else {
      text = await requiredText(source ? ["-"] : [], "the document body (a file path, or Markdown on stdin)");
    }
  } else {
    text = await requiredText(rest.slice(1), "the text to append");
  }

  const op = existing
    ? mode === "write"
      ? { type: "updateDocument", id: existing.id, patch: { body: text } }
      : { type: "appendToDocument", id: existing.id, text }
    : { type: "addDocument", document: { title, body: text } };
  const res = await api.ops([op]);
  const id = res.results[0]?.id;
  const name = existing?.title ?? title;
  out(`${existing ? (mode === "write" ? "Replaced" : "Appended to") : "Created"} "${name}"`);
  out(pageUrl(ref, board.project.title, `/docs/${id}`));
}

const ALIASES: Record<string, string> = { status: "board", ls: "board", list: "board", open: "url", unclaim: "release" };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [name, ...rest] = args._;
  if (args.flags.version) return out(`kanban ${VERSION}`);
  if (!name || name === "help" || args.flags.help) return out(helpText(DEFAULT_ORIGIN));
  const command = commands[ALIASES[name] ?? name];
  if (!command) throw new CliError(`Unknown command "${name}". Run \`kanban help\`.`, 2);
  await command(args, rest);
}

main().catch((err) => {
  const code = err instanceof CliError ? err.exitCode : 1;
  process.stderr.write(`kanban: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(code);
});
