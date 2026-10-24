/**
 * kanban — a command-line client for Kanban projects, aimed at AI agents (and
 * humans) planning and tracking work from a terminal. It is served by the app
 * itself at /kanban.js and installed with `curl -fsSL <origin>/install | sh`.
 * It only uses the public HTTP API documented at /llms.txt. Node 18+ or Bun.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { toShortId } from "../shared/ids";
import { CLI_VERSION } from "../shared/cli-version";
import { KEY_HEADER, KEY_RE, type KeyInfo } from "../shared/keys";
import { DEFAULT_COLUMNS, LIMITS } from "../shared/types";
import type { ActivityEntry } from "../shared/activity";
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
  formatActivity,
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
  timestamp,
  todoColumn,
  type Args,
  type ProjectRef,
} from "./lib";
import { claudeSkill } from "./claude-skill";
import { readLastCheck, selfUpdate, shouldAutoCheck } from "./update";
import { colorEnabled, column as columnStyle, createStyle, link, num, person, plain, success, type Style } from "./style";

const VERSION = CLI_VERSION;
const CONFIG_FILE = ".kanban";

// The server replaces this placeholder with its own origin when serving the script.
const SERVED_FROM: string = "__KANBAN_ORIGIN__";
// Only a copy downloaded from a server (installed, or run straight from /kanban.js) can update itself.
const INSTALLED = SERVED_FROM.startsWith("http");
const DEFAULT_ORIGIN =
  process.env.KANBAN_ORIGIN || (SERVED_FROM.startsWith("http") ? SERVED_FROM : "https://kanban.infopanel.org");

interface Config {
  project: string;
  agent?: string;
  /** Key for a protected project. */
  key?: string;
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

function writeConfig(config: Config, path = join(process.cwd(), CONFIG_FILE)): string {
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
}

/** The .kanban file `projectFor` would use, unless the project is given by flag or environment. */
function linkedConfig(args: Args) {
  return flag(args, "project") ?? process.env.KANBAN_PROJECT ? null : findConfig();
}

function projectFor(args: Args): ProjectRef {
  const linked = linkedConfig(args);
  const value = flag(args, "project") ?? process.env.KANBAN_PROJECT ?? linked?.config.project;
  if (!value) {
    throw new CliError(
      "No project linked here. Run `kanban init <project-url>` to link an existing project, or `kanban new <title>` to create one.",
      2,
    );
  }
  const ref = parseProjectRef(value, DEFAULT_ORIGIN);
  const key = flag(args, "key") ?? process.env.KANBAN_KEY ?? ref.key ?? linked?.config.key;
  return withKey(ref, key);
}

function withKey(ref: ProjectRef, key: string | undefined): ProjectRef {
  if (!key) return ref;
  if (!KEY_RE.test(key)) throw new CliError(`"${key}" isn't a project key. Keys are 16 letters and digits.`, 2);
  return { ...ref, key };
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

// Set in main() once flags are parsed: color for stdout and stderr respectively.
let st: Style = plain;
let errStyle: Style = plain;

const out = (text: string): void => {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
};
const json = (value: unknown) => out(JSON.stringify(value, null, 2));

// -- API ----------------------------------------------------------------------

/** The project needs a key, or the one given doesn't work. */
class KeyError extends CliError {}

class Api {
  constructor(readonly ref: ProjectRef) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.ref.origin}/api/p/${this.ref.id}${path}`, {
        ...init,
        headers: {
          "User-Agent": `kanban-cli/${VERSION}`,
          ...(this.ref.key ? { [KEY_HEADER]: this.ref.key } : {}),
          ...init?.headers,
        },
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
      const code = (body as { code?: string })?.code;
      if (code === "key_required") {
        throw new KeyError(
          "This project is protected by a key. Link it with `kanban init <project-url> --key <key>`, or set KANBAN_KEY.",
        );
      }
      if (code === "key_invalid") {
        throw new KeyError(
          "The key for this project doesn't work. It may have been revoked. Get a new key, then run `kanban init <project-url> --key <key>`.",
        );
      }
      const message = (body as { error?: string })?.error ?? `HTTP ${res.status}`;
      throw new CliError(message, res.status === 409 ? 3 : 1);
    }
    return body as T;
  }

  board = () => this.request<ExportedProject>("");

  activity = (limit: number) =>
    this.request<{ entries: ActivityEntry[]; more: boolean }>(`/activity?limit=${limit}`);

  keys = () => this.request<{ keys: KeyInfo[] }>("/keys").then((b) => b.keys);

  addKey = () => this.request<Omit<KeyInfo, "current"> & { key: string }>("/keys", { method: "POST" });

  revokeKey = (id: string) => this.request<{ ok: true }>(`/keys/${id}`, { method: "DELETE" });

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
      out(success(st, `Created ${st.bold(title)} and linked it in ${st.dim(path)}`));
    } else {
      out(success(st, `Created ${st.bold(title)}`));
    }
    out(link(st, res.url));
    out(st.dim("Anyone with this link can view and edit the board. Share it with your human; don't commit .kanban to a public repository."));
  },

  async init(args, rest) {
    const target = rest[0];
    if (!target) throw new CliError("Usage: kanban init <project-url>", 2);
    const parsed = parseProjectRef(target, DEFAULT_ORIGIN);
    const ref = withKey(parsed, flag(args, "key") ?? parsed.key);
    const board = await new Api(ref).board().catch((err: CliError) => {
      if (err instanceof KeyError) throw err;
      throw new CliError(`${err.message} Check the link, or create a project with \`kanban new <title>\`.`);
    });
    const url = pageUrl(ref, board.project.title);
    const agent = flag(args, "as");
    const path = writeConfig({ project: url, ...(agent ? { agent } : {}), ...(ref.key ? { key: ref.key } : {}) });
    out(success(st, `Linked ${st.dim(path)} to ${st.bold(board.project.title)}`));
    out(link(st, url));
    out(
      st.dim(
        ref.key
          ? "The link and key in .kanban let anyone edit the board; don't commit .kanban to a public repository."
          : "Anyone with this link can view and edit the board; don't commit .kanban to a public repository.",
      ),
    );
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
    out(formatBoard(board, ref, st));
  },

  async show(args, rest) {
    const ref = projectFor(args);
    const board = await new Api(ref).board();
    const card = findCard(board, String(cardRef(rest[0])));
    if (args.flags.json) {
      const { column, ...rest } = card;
      return json({ ...rest, status: column.name, columnId: column.id });
    }
    out(formatCard(card, ref, board.project.title, st));
  },

  async next(args) {
    const ref = projectFor(args);
    const board = await new Api(ref).board();
    const column = flag(args, "column") ? findColumn(board, flag(args, "column")!) : todoColumn(board);
    const card = nextCard(column);
    if (args.flags.json) return json(card ? { ...card, status: column.name } : null);
    if (!card) return out(`No unclaimed cards in ${st.bold(column.name)}.`);
    out(formatCard({ ...card, column }, ref, board.project.title, st));
    out(`\n${st.dim("Start it with:")} ${st.cyan(`kanban start ${card.number}`)}`);
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
    out(success(st, `${num(st, res.results[0]?.number ?? "?")} ${title} ${st.dim("added to")} ${columnStyle(st, column.name)}`));
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
    out(success(st, `${num(st, card.number)} ${card.title} ${st.dim("→")} ${columnStyle(st, target.name)} ${st.dim("(claimed by")} ${person(st, who)}${st.dim(")")}`));
  },

  async log(args, rest) {
    const ref = projectFor(args);
    const id = cardRef(rest[0]);
    const text = await requiredText(rest.slice(1), "the note to log");
    const res = await new Api(ref).ops([{ type: "appendToCard", id, text: logEntry(text, agentName(args)) }]);
    out(success(st, `Logged on ${num(st, res.results[0]?.number ?? "?")}`));
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
    out(success(st, `${num(st, card.number)} ${card.title} ${st.dim("→")} ${columnStyle(st, target.name)}`));
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
    out(success(st, `${num(st, card.number)} ${card.title} ${st.dim("→")} ${columnStyle(st, target.name)}`));
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
    out(success(st, `Updated ${num(st, res.results[0]?.number ?? "?")}`));
  },

  async claim(args, rest) {
    const ref = projectFor(args);
    const who = agentName(args);
    const id = cardRef(rest[0]);
    const res = await new Api(ref)
      .ops([{ type: "claimCard", id, assignee: who, force: args.flags.force === true }])
      .catch((err) => claimError(err, id));
    out(success(st, `${num(st, res.results[0]?.number ?? "?")} claimed by ${person(st, who)}`));
  },

  async release(args, rest) {
    const ref = projectFor(args);
    const res = await new Api(ref).ops([{ type: "updateCard", id: cardRef(rest[0]), patch: { assignee: "" } }]);
    out(success(st, `${num(st, res.results[0]?.number ?? "?")} is unassigned`));
  },

  async delete(args, rest) {
    const id = cardRef(rest[0]);
    if (!args.flags.yes) throw new CliError(`This permanently deletes the card. Re-run with --yes: kanban delete ${rest[0]} --yes`, 2);
    const ref = projectFor(args);
    const board = await new Api(ref).board();
    const card = findCard(board, String(id));
    await new Api(ref).ops([{ type: "deleteCard", id: card.id }]);
    out(success(st, `Deleted ${num(st, card.number)} ${card.title}`));
  },

  async activity(args) {
    const ref = projectFor(args);
    const raw = flag(args, "limit") ?? "20";
    const limit = Number(raw);
    if (!Number.isInteger(limit) || limit < 1) throw new CliError(`--limit must be a positive whole number, not "${raw}".`, 2);
    const { entries } = await new Api(ref).activity(limit);
    if (args.flags.json) return json(entries);
    if (!entries.length) return out("No activity yet.");
    // Oldest first, like a log, so the latest change is right above the prompt.
    out(entries.reverse().map((e) => formatActivity(e, st)).join("\n"));
  },

  async docs(args) {
    const ref = projectFor(args);
    const board = await new Api(ref).board();
    const docs = board.project.documents;
    if (args.flags.json) return json(docs.map(({ body, ...d }) => ({ ...d, length: body.length })));
    if (!docs.length) return out(`No documents. Create one with: ${st.cyan('kanban doc write "Title" notes.md')}`);
    out(docs.map((d) => `${st.dim(d.id)}  ${d.title || "Untitled"}  ${st.dim(`(${d.body.length} chars)`)}`).join("\n"));
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
    out(doc.body || st.dim("(empty document)"));
  },

  async keys(args, rest) {
    const [sub = "list", target] = rest;
    const ref = projectFor(args);
    const api = new Api(ref);

    if (sub === "list") {
      const keys = await api.keys();
      if (args.flags.json) return json(keys);
      if (!keys.length) {
        return out(`No keys: anyone with the link can open this project. Protect it with ${st.cyan("kanban keys add")}.`);
      }
      out(
        keys
          .map((k) => `${st.dim(k.id)}  ${k.hint}…  ${st.dim(`created ${timestamp(k.createdAt)}`)}${k.current ? `  ${st.green("(yours)")}` : ""}`)
          .join("\n"),
      );
      return;
    }

    if (sub === "add") {
      const first = (await api.keys()).length === 0;
      const created = await api.addKey();
      if (args.flags.json) return json(created);
      out(created.key);
      // The first key locks the project, so keep it where later commands will find it.
      const linked = linkedConfig(args);
      if (first && linked) {
        writeConfig({ ...linked.config, key: created.key }, linked.path);
        out(st.dim(`The project now needs a key. This one is saved in ${linked.path}.`));
      } else if (first) {
        out(st.dim("The project now needs a key. Save this one: pass it with --key or KANBAN_KEY."));
      } else {
        out(st.dim("Give this key to whoever needs access. It can't be shown again."));
      }
      return;
    }

    if (sub === "revoke") {
      if (!target) throw new CliError("Usage: kanban keys revoke <id|first characters>", 2);
      const keys = await api.keys();
      const matches = keys.filter((k) => k.id === target || k.hint.startsWith(target) || target.startsWith(k.hint));
      if (matches.length !== 1) {
        throw new CliError(matches.length ? `"${target}" matches more than one key. Use the id from \`kanban keys\`.` : `No key "${target}". Run \`kanban keys\` to list them.`, 2);
      }
      if (matches[0]!.current) throw new CliError("You can't revoke the key you're using. Use another key to revoke this one.");
      await api.revokeKey(matches[0]!.id);
      return out(success(st, `Revoked the key ${matches[0]!.hint}…`));
    }

    throw new CliError("Usage: kanban keys [list|add|revoke <id>]", 2);
  },

  async "install-skill"(args) {
    const skill = claudeSkill(DEFAULT_ORIGIN);
    if (args.flags.print) return out(skill.trimEnd());
    const base = args.flags.local ? process.cwd() : homedir();
    const path = join(base, ".claude", "skills", "kanban", "SKILL.md");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, skill);
    out(success(st, `Installed the Claude Code skill to ${st.dim(path)}`));
    out(st.dim("In Claude Code, run /kanban next to work through the Todo column of the board linked in .kanban."));
  },

  async upgrade() {
    if (!INSTALLED) throw new CliError("This copy of kanban wasn't downloaded from a server, so it can't update itself.");
    const res = await selfUpdate(SERVED_FROM, VERSION, process.env).catch((err: Error) => {
      throw new CliError(`Couldn't update: ${err.message}. Try: curl -fsSL ${SERVED_FROM}/install | sh`);
    });
    if (!res.updated) return out(`kanban ${VERSION} is the latest version.`);
    out(success(st, `Updated kanban ${res.from} → ${res.to}`));
    refreshSkill();
  },

  async whoami(args) {
    out(`${person(st, agentName(args))} on ${(() => {
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
  out(success(st, `${existing ? (mode === "write" ? "Replaced" : "Appended to") : "Created"} ${st.bold(name)}`));
  out(link(st, pageUrl(ref, board.project.title, `/docs/${id}`)));
}

const ALIASES: Record<string, string> = { status: "board", ls: "board", list: "board", open: "url", unclaim: "release", "self-update": "upgrade" };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  st = createStyle(colorEnabled(args.flags, process.stdout.isTTY, process.env));
  errStyle = createStyle(colorEnabled(args.flags, process.stderr.isTTY, process.env));
  const [name, ...rest] = args._;
  if (args.flags.version) return out(`kanban ${VERSION}`);
  if (!name || name === "help" || args.flags.help) return out(helpText(DEFAULT_ORIGIN, st));
  const command = commands[ALIASES[name] ?? name];
  if (!command) throw new CliError(`Unknown command "${name}". Run \`kanban help\`.`, 2);
  await command(args, rest);
  if ((ALIASES[name] ?? name) !== "upgrade") await autoUpdate();
}

/** At most once a day, quietly update an installed CLI. Never fails the command it follows. */
async function autoUpdate() {
  if (!INSTALLED || !shouldAutoCheck(process.env, readLastCheck(process.env), Date.now())) return;
  try {
    const res = await selfUpdate(SERVED_FROM, VERSION, process.env);
    if (!res.updated) return;
    // stderr, so --json output on stdout stays parseable.
    process.stderr.write(`${errStyle.dim(`kanban updated itself ${res.from} → ${res.to}. Set KANBAN_NO_UPDATE=1 to turn this off.`)}\n`);
    refreshSkill();
  } catch {
    // Offline or the server is unreachable: try again tomorrow.
  }
}

/** Rewrites an installed Claude Code skill with the new version's text. */
function refreshSkill() {
  const path = join(homedir(), ".claude", "skills", "kanban", "SKILL.md");
  if (!existsSync(path)) return;
  try {
    const res = spawnSync(process.execPath, [process.argv[1]!, "install-skill"], { env: { ...process.env, KANBAN_NO_UPDATE: "1" } });
    if (res.status === 0) process.stderr.write(`${errStyle.dim("Updated the Claude Code skill too.")}\n`);
  } catch {
    // The skill keeps its previous text; `kanban install-skill` refreshes it.
  }
}

main().catch((err) => {
  const code = err instanceof CliError ? err.exitCode : 1;
  process.stderr.write(`${errStyle.red(errStyle.bold("kanban:"))} ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(code);
});
