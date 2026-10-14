# kanban

A small real-time kanban board on Cloudflare Workers. No accounts: create a project, share the
`/p/<name>/<uuid>` link, and anyone with it can view and edit live. Only the UUID matters; the name is a
slug of the project title that follows renames, and `/p/<uuid>` works too. Each project has a board and a flat list of
Markdown documents, and agents can work with it over a plain HTTP API.

## For agents

`/llms.txt` explains the app and API. `/api/p/<uuid>/llms.txt` is generated per project: it includes
the current board with ids, copy-pasteable `curl` commands, and a working agreement for tracking work
on the board. The project menu's **Copy agent instructions** puts a ready-made prompt on the clipboard.

Project pages are a client-side app, so the Worker also makes them useful without a browser
(`src/worker/pages.ts`): the HTML includes `<link rel="alternate">` tags and a short, visually hidden note
with the project's API URLs (React replaces it on load), and requesting a page with
`Accept: text/markdown` returns the project's `llms.txt`, or the document's Markdown on a document page.

| Method | Path | |
| --- | --- | --- |
| GET | `/api/p/<uuid>` | Project as JSON (same shape as an export) |
| GET | `/api/p/<uuid>/documents/<id>` | One document as Markdown with front matter |
| POST | `/api/p/<uuid>/ops` | `{"ops": [...]}`: batch edits, validated together, broadcast live |
| POST | `/api/p/<uuid>/import` | Replace the whole project with an export file |

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
