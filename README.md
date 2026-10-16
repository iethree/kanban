# kanban

A small real-time kanban board on Cloudflare Workers. No accounts: create a project, share the
`/p/<name>/<id>` link, and anyone with it can view and edit live. Cards can be viewed as a board or as a
list grouped into collapsible status sections (`/p/<name>/<id>/list`). Only the id matters; the name is a
slug of the project title that follows renames, and `/p/<id>` works too.

Project ids are UUIDs internally (they name the Durable Object). URLs show a 22-character, case-sensitive
base62 encoding of the same 128 bits (`src/shared/ids.ts`), and every page and API route accepts either form. Each project has a board and a flat list of
Markdown documents, and agents can work with it over a plain HTTP API.

## For agents

### CLI

Agents with a shell can use the `kanban` CLI, which the app serves itself (one dependency-free file;
Node 18+ or Bun):

```sh
curl -fsSL https://kanban.infopanel.org/install | sh
kanban init https://kanban.infopanel.org/p/<name>/<id>   # or: kanban new "Project title"
kanban next && kanban start 12
kanban log 12 "Root cause: expired token cache"
kanban done 12 "Fixed in a1b2c3d"
```

`kanban init` writes a `.kanban` file so later commands know the project; `KANBAN_AGENT` (or `--as`)
names the agent for claims and notes. Run `kanban help` for everything else. The source is in
`src/cli/` and is bundled to `dist/kanban.js`; the Worker serves it at `/kanban.js` with its own origin
filled in, plus the installer at `/install`.

Cards have short numbers (#12). `claimCard` refuses to take a card someone else holds (409), and
`appendToCard` / `appendToDocument` add notes without overwriting anyone's edits.

### HTTP

`/llms.txt` explains the app and API. `/api/p/<id>/llms.txt` is generated per project: it includes
the current board with ids, copy-pasteable `curl` commands, and a working agreement for tracking work
on the board. The project menu's **Copy agent instructions** puts a ready-made prompt on the clipboard.

Project pages are a client-side app, so the Worker also makes them useful without a browser
(`src/worker/pages.ts`): the HTML includes `<link rel="alternate">` tags and a short, visually hidden note
with the project's API URLs (React replaces it on load), and requesting a page with
`Accept: text/markdown` returns the project's `llms.txt`, or the document's Markdown on a document page.

| Method | Path | |
| --- | --- | --- |
| GET | `/api/p/<id>` | Project as JSON (same shape as an export) |
| GET | `/api/p/<id>/documents/<docId>` | One document as Markdown with front matter |
| POST | `/api/p/<id>/ops` | `{"ops": [...]}`: batch edits, validated together, broadcast live |
| POST | `/api/p/<id>/import` | Replace the whole project with an export file |

## Develop

```bash
bun install
bun run dev        # wrangler dev on http://localhost:8787 (rebuilds the frontend on change)
bun test           # reducer + import/export tests
bun run typecheck
```

## Deploy

```bash
bunx wrangler login
bun run deploy
```

Deploys to https://kanban.infopanel.org as a Workers custom domain (see `routes` in
`wrangler.jsonc`). The `infopanel.org` zone must be on the same Cloudflare account.

## How it works

- **`src/worker/index.ts`**: routes `/api/p/:id/{ws,export,import}` to a Durable Object. Everything
  else is served from static assets with SPA fallback.
- **`src/worker/project-room.ts`**: one Durable Object per project. Stores the project in SQLite
  (metadata in one row, one row per card and per document), relays edits over hibernatable WebSockets,
  and serves the HTTP API.
- **`src/worker/llms.ts`**: generates the `llms.txt` files.
- **`src/shared/reducer.ts`**: a pure, deterministic `applyOp(doc, op)` that the server and the
  browser share. Clients apply their edits optimistically, the server orders them, and clients
  rebase any still-pending edits on top of what the server confirms. Ops are idempotent, so
  unacknowledged edits are simply resent after a reconnect.
- **`src/client`**: React + dnd-kit, bundled by Bun (`scripts/build-client.ts`) into `dist/`.
  Recently visited projects are kept in `localStorage`.

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
        "cards": [{ "title": "First card", "description": "", "priority": "high", "size": "m" }]
      }
    ],
    "documents": [{ "title": "Notes", "body": "# Markdown here" }]
  }
}
```

`priority` is `none | low | medium | high` and `size` is `none | xs | s | m | l | xl`. Ids, timestamps and
`documents` are optional on import. Card descriptions and document bodies are Markdown.
