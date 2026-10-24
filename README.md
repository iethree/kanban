# kanban

A small real-time kanban board on Cloudflare Workers. No accounts: create a project, share the
`/p/<name>/<id>` link, and anyone with it can view and edit live. Each project has a board, a list view
grouped into collapsible status sections, and a flat list of Markdown documents. AI agents can work with
it through the `kanban` CLI or a plain HTTP API.

Only the id in a project URL matters. The name before it is a slug of the project title that follows
renames, and `/p/<id>` works too. Project ids are UUIDs internally (they name the Durable Object); URLs
show a 22-character, case-sensitive base62 encoding of the same 128 bits (`src/shared/ids.ts`), and every
page and API route accepts either form.

## Command-line interface

`kanban` is a CLI for planning and tracking work from a terminal, built mainly for AI agents but
pleasant for humans too. The app serves it itself, so it always matches the server it came from. It is
a single dependency-free file that runs on Node 18+ or Bun.

### Install

```sh
curl -fsSL https://kanban.infopanel.org/install | sh
```

This installs `kanban` to `~/.local/bin` (set `KANBAN_INSTALL_DIR` to change it) and checks that it runs
before replacing an existing copy. Re-run the same command to update.

### Set up a project

```sh
kanban new "Website relaunch"                  # create a project and link this directory
kanban init https://kanban.infopanel.org/p/website-relaunch/<id>   # or link an existing one
```

Both write a `.kanban` file in the current directory, and later commands find it by walking up from
wherever you run them (like `.git`). The file holds the project link, which is also the key to edit
the board, so don't commit it to a public repository.

```json
{ "project": "https://kanban.infopanel.org/p/website-relaunch/<id>", "agent": "claude" }
```

`agent` is optional; it names you on claims and progress notes.

### Typical loop

```sh
kanban next                           # highest-priority unclaimed card in "Todo"
kanban start 12                       # claim #12 and move it to the top of "In progress"
kanban log 12 "Root cause: expired token cache"
kanban done 12 "Fixed in a1b2c3d"     # append the summary and move it to "Done"
```

`start` refuses a card someone else has claimed (exit code 3), so several agents can share one board
without picking up the same work. `log` and `done` append timestamped notes to the card's description
(`**2026-10-15 14:03 UTC · claude:** …`) and never overwrite what's there.

### Commands

Cards are referenced by number (`12` or `#12`). Column and document names match case-insensitively,
and a unique prefix is enough. Any text argument can be `-` to read from stdin.

| Command | What it does |
| --- | --- |
| `kanban new <title> [--columns "A,B,C"] [--description TEXT]` | Create a project and link this directory |
| `kanban init <project-url>` | Link this directory to an existing project |
| `kanban url` | Print the project's web address, to share with a human |
| `kanban board` | Columns and cards: `#12 title [priority, size] @assignee` |
| `kanban show <card>` | One card, including its description |
| `kanban next [--column C]` | Highest-priority unclaimed card in the Todo column (or `C`) |
| `kanban add <title> [--column C] [--priority P] [--size S] [--description TEXT\|-]` | Add a card (to the first column by default) |
| `kanban start <card> [--force] [--column C]` | Claim a card and move it to the in-progress column |
| `kanban log <card> <text\|->` | Append a timestamped progress note |
| `kanban done <card> [summary] [--column C]` | Append the summary and move the card to the done column |
| `kanban move <card> <column>` | Move a card to the top of another column |
| `kanban update <card> [--title T] [--priority P] [--size S] [--assignee NAME] [--description TEXT\|-]` | Change fields (`--description` replaces the whole text) |
| `kanban claim <card> [--force]` / `kanban release <card>` | Set or clear the assignee without moving the card |
| `kanban delete <card> --yes` | Delete a card |
| `kanban activity [--limit N]` | Recent changes, oldest first: moves, claims, edits and notes, each marked `user` or `agent` (default 20) |
| `kanban docs` | List documents |
| `kanban doc <title\|id>` | Print a document's Markdown |
| `kanban doc write <title> [file\|-]` | Create or replace a document |
| `kanban doc append <title> <text\|->` | Append to a document (creates it if missing) |

Priority is `none | low | medium | high`; size is `none | xs | s | m | l | xl`. `next` looks for a
column named like "Todo", "Next" or "Ready" (falling back to the first column), `start` for one named
like "In progress" or "Doing" (falling back to the second), and `done` for one named like "Done" or
"Shipped" (falling back to the last), unless you pass `--column`. New projects start with Backlog,
Todo, In progress and Done.

### Options and environment

| | |
| --- | --- |
| `--json` | Machine-readable output for `board`, `show`, `next`, `docs` and `doc` |
| `--as NAME` / `KANBAN_AGENT` | Your name for claims and notes (default: `agent` in `.kanban`, then your username) |
| `--project REF` / `KANBAN_PROJECT` | Project URL or id, overriding `.kanban` |
| `KANBAN_ORIGIN` | Server to use when a project is given as a bare id, or for `kanban new` |
| `--no-color` / `--color` | Turn color off or on. By default it's used only when output goes to a terminal, so agents and pipes get plain text. `NO_COLOR` and `FORCE_COLOR` are respected too. |

Exit codes: `0` ok, `1` error, `2` bad usage, `3` card already claimed by someone else.

### Pointing an agent at a board

Add something like this to a repository's `AGENTS.md` or `CLAUDE.md`. It deliberately leaves out the
project link and points at `.kanban` instead: the link is the key to edit the board, so it must not end up
in a public repository. The project menu's **Copy agent instructions** produces a version with the real
link, for pasting into an agent's prompt.

```md
Plan and track your work on the kanban board linked in `.kanban`.
Use the `kanban` CLI (`kanban help`): `kanban next`, `kanban start <n>`, `kanban log <n> "..."`,
`kanban done <n> "..."`. Add follow-up work with `kanban add`. Set KANBAN_AGENT to your name.
```

## HTTP API

Agents without a shell can use the API directly. `/llms.txt` explains the app and API, and
`/api/p/<id>/llms.txt` is generated per project: the current board with card numbers, copy-pasteable
`curl` commands, and a working agreement for tracking work on the board.

| Method | Path | |
| --- | --- | --- |
| GET | `/api/p/<id>` | Project as JSON (same shape as an export) |
| GET | `/api/p/<id>/llms.txt` | Instructions and a Markdown snapshot of the board |
| GET | `/api/p/<id>/activity?limit&before` | Activity feed, newest first. Each entry's `user` is `"user"` (made in the browser) or `"agent"` (made through this API) |
| GET | `/api/p/<id>/documents/<docId>` | One document as Markdown with front matter |
| POST | `/api/p/<id>/ops` | `{"ops": [...]}`: batch edits, validated together, broadcast live |
| POST | `/api/p/<id>/import` | Replace the whole project with an export file |

Card ops accept a card number (`12` or `"#12"`) as the `id`, and `column` names instead of ids.
`claimCard` returns 409 if someone else holds the card, and `appendToCard` / `appendToDocument` add text
without overwriting anyone's edits. `POST /ops` returns the project `url` and each card's `number`.

The app is client-side, so the Worker also makes its pages useful without a browser
(`src/worker/pages.ts`). The home page and project pages include `<link rel="alternate">` tags and a
short, visually hidden note (React replaces it on load) that leads with the CLI install and commands
for that page, including `kanban show` / `kanban doc` when a card or document is open, then the HTTP
endpoints. Requesting any of them with `Accept: text/markdown` returns the relevant `llms.txt`, or the
document's Markdown on a document page.

## Develop

```bash
bun install
bun run dev        # wrangler dev on http://localhost:8787; rebuilds the frontend and CLI on change
bun test           # reducer, ids/URLs, page markup and CLI tests
bun run typecheck
```

`bun run dev` keeps the real local origin, so you can try the CLI against it:

```bash
curl -fsSL http://localhost:8787/install | KANBAN_INSTALL_DIR=/tmp/kanban-bin sh
/tmp/kanban-bin/kanban new "Local test"
```

## Deploy

```bash
bunx wrangler login
bun run deploy
```

Deploys to https://kanban.infopanel.org as a Workers custom domain (see `routes` in
`wrangler.jsonc`). The `infopanel.org` zone must be on the same Cloudflare account.

## How it works

- **`src/worker/index.ts`**: routes `/api/p/<id>/…` to the project's Durable Object, serves `/llms.txt`,
  the CLI (`/kanban.js`) and its installer (`/install`), and adds agent hints to `/p/…` pages.
  Everything else is served from static assets with SPA fallback.
- **`src/worker/project-room.ts`**: one Durable Object per project. Stores the project in SQLite
  (metadata in one row, one row per card and per document), relays edits over hibernatable WebSockets,
  and serves the HTTP API.
- **`src/worker/llms.ts`**, **`pages.ts`**, **`cli.ts`**: the `llms.txt` files, page markup for agents,
  and serving the CLI.
- **`src/shared/reducer.ts`**: a pure, deterministic `applyOp(doc, op)` that the server and the
  browser share. Clients apply their edits optimistically, the server orders them, and clients
  rebase any still-pending edits on top of what the server confirms. Ops are idempotent, so
  unacknowledged edits are simply resent after a reconnect.
- **`src/client`**: React + dnd-kit, bundled by Bun into `dist/`. Recently visited projects are kept
  in `localStorage`.
- **`src/cli`**: the `kanban` CLI. `scripts/build-client.ts` bundles it into a single CommonJS file,
  `dist/kanban.js`; the Worker fills in its own origin as the default server when serving it.

## Import / export format

```json
{
  "kind": "kanban-project",
  "version": 1,
  "project": {
    "title": "My project",
    "description": "",
    "columns": [
      {
        "name": "Backlog",
        "cards": [{ "title": "First card", "description": "", "priority": "high", "size": "m", "assignee": "" }]
      }
    ],
    "documents": [{ "title": "Notes", "body": "# Markdown here" }]
  }
}
```

`priority` is `none | low | medium | high` and `size` is `none | xs | s | m | l | xl`. Ids, card numbers,
assignees, timestamps and `documents` are optional on import. Card descriptions and document bodies are
Markdown.
