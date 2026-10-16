import type { Card, Doc, ProjectDocument } from "../shared/types";
import { LIMITS } from "../shared/types";
import { toShortId } from "../shared/ids";
import { projectPath } from "../shared/urls";

/** The "use the CLI" section, shown before the raw HTTP API in both llms.txt files. */
function cliSection(origin: string, projectUrl?: string): string {
  return `## Quickest path: the \`kanban\` CLI

If you can run shell commands, use the CLI instead of hand-writing HTTP requests. It needs Node 18+ or Bun.

\`\`\`sh
curl -fsSL ${origin}/install | sh
${projectUrl ? `kanban init ${projectUrl}` : `kanban new "Project title"     # or: kanban init <project-url>`}
kanban board                     # columns and cards: #12 title [priority, size] @assignee
kanban next                      # the highest-priority unclaimed card
kanban start 12                  # claim it and move it to In progress
kanban log 12 "Found the cause: …"
kanban done 12 "Fixed in a1b2c3d"
\`\`\`

\`kanban init\` writes a \`.kanban\` file in the current directory so later commands know the project. Set
\`KANBAN_AGENT\` (or pass \`--as NAME\`) so your claims and notes carry your name. Run \`kanban help\` for the rest:
adding cards, updating fields, documents (\`kanban doc write "Plan" plan.md\`) and \`--json\` output.`;
}

/** Cards listed per column in a project's llms.txt before pointing at the JSON endpoint. */
const MAX_LISTED_CARDS = 150;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** A copy-pasteable curl command posting the given ops, single-quoted for the shell. */
function curlOps(base: string, ops: unknown[]): string {
  const body = JSON.stringify({ ops }).replace(/'/g, `'\\''`);
  return `curl -s -X POST ${base}/ops -H 'Content-Type: application/json' \\\n  -d '${body}'`;
}

function apiReference(base: string): string {
  return `## API

No authentication: the project URL is the credential. Send JSON with \`Content-Type: application/json\`.

| Method | Path | What it does |
| --- | --- | --- |
| GET | \`${base}\` | Full project as JSON: columns in order, each with its cards in order, plus documents. |
| GET | \`${base}/llms.txt\` | This project's instructions and a Markdown snapshot of the board. |
| GET | \`${base}/documents/<documentId>\` | One document as raw Markdown, with its title and timestamps as front matter. |
| POST | \`${base}/ops\` | Apply edits. Body: \`{"ops": [op, ...]}\` (max 100). Applied in order and shown live to anyone viewing the board. |
| POST | \`${base}/import\` | Replace the **entire** project with an export file. Destructive — only if a human asks. |

\`POST /ops\` validates every op before applying any. On success it returns
\`{"ok": true, "version": n, "url": "<project page>", "results": [{"type", "id", "number", "changed"}]}\`, where \`id\` is the id of
the thing the op touched (including ids generated for new cards, columns and documents) and \`number\` is the
card's #number. Errors return \`{"ok": false, "error": "..."}\` with status 400 (bad op), 404 (project not
created yet) or 409 (card already claimed by someone else).

### Ops

Fields marked optional may be left out.

**Cards** — every card has a short \`number\` (shown as #12). \`priority\`: \`none | low | medium | high\`.
\`size\`: \`none | xs | s | m | l | xl\` (relative effort; \`none\` = not estimated yet). \`assignee\`: who is working on it
(\`""\` = nobody). Descriptions are Markdown.

\`\`\`json
{"type": "addCard", "column": "Backlog", "card": {"title": "Write tests", "description": "", "priority": "medium", "size": "s"}}
{"type": "claimCard", "id": 12, "assignee": "claude"}
{"type": "appendToCard", "id": 12, "text": "**Progress:** tests written, 2 failing"}
{"type": "moveCard", "id": 12, "column": "In progress", "index": 0}
{"type": "updateCard", "id": 12, "patch": {"title": "...", "description": "...", "priority": "high", "size": "m", "assignee": ""}}
{"type": "deleteCard", "id": 12}
\`\`\`

- \`id\` for card ops can be the card's number (\`12\` or \`"#12"\`) or its string id.
- \`column\` matches a column name (case-insensitive); you can pass \`columnId\` instead.
- \`claimCard\` fails with 409 if someone else already holds the card, so two agents can't take the same work.
  Add \`"force": true\` only if a human asked you to take it over.
- \`appendToCard\` adds a paragraph to the end of the description without touching the rest. Prefer it to
  \`updateCard\` for progress notes; it can't overwrite someone else's edits.
- \`addCard\`: \`index\` optional (default: bottom), \`card.id\` optional (generated), other card fields optional.
- \`moveCard\`: \`index\` is the card's final position in the target column (0 = top); omit it to move to the bottom.
- \`updateCard\`: \`patch\` may contain any subset of fields. Text fields are **replaced** — read the current
  value first, or use \`appendToCard\`.

**Columns** (a card's status is the column it is in)

\`\`\`json
{"type": "addColumn", "name": "Review", "index": 2}
{"type": "renameColumn", "id": "COLUMN_ID", "name": "QA"}
{"type": "moveColumn", "id": "COLUMN_ID", "index": 0}
{"type": "deleteColumn", "id": "COLUMN_ID"}
\`\`\`

\`deleteColumn\` also deletes every card in that column.

**Documents** — a flat list of Markdown pages for plans, specs, notes and decisions.

\`\`\`json
{"type": "addDocument", "document": {"title": "Release plan", "body": "# Release plan\\n..."}}
{"type": "updateDocument", "id": "DOCUMENT_ID", "patch": {"title": "...", "body": "..."}}
{"type": "appendToDocument", "id": "DOCUMENT_ID", "text": "## 2026-10-15\n- decided X"}
{"type": "deleteDocument", "id": "DOCUMENT_ID"}
\`\`\`

**Project**

\`\`\`json
{"type": "updateProject", "title": "...", "description": "..."}
\`\`\`

Limits: titles ${LIMITS.title} chars, card descriptions ${LIMITS.description.toLocaleString("en-US")} chars,
document bodies ${LIMITS.body.toLocaleString("en-US")} chars, ${LIMITS.columns} columns, ${LIMITS.cards.toLocaleString("en-US")} cards,
${LIMITS.documents} documents. Longer text is truncated.`;
}

const WORKING_AGREEMENT = `## Working agreement for agents

Use the board as the shared source of truth for your work. Humans may be watching and editing at the same time.

1. **Read before you write.** Fetch the board at the start of a session and before changing a card, since
   people edit concurrently.
2. **Claim work visibly.** Before you start a card, claim it with your name and move it to the top of the
   in-progress column (e.g. "In progress"); \`kanban start 12\` does both. If it's claimed by someone else, pick
   another card. Work on one card at a time unless asked otherwise.
3. **Log progress on the card** by appending (\`kanban log 12 "…"\` or \`appendToCard\`), never by rewriting the
   description. Keep notes short and factual: what changed, links, what's next.
4. **Finish cleanly.** When a card is done, add a one-line summary of the outcome and move it to the done
   column (e.g. "Done").
5. **Say when you're blocked.** Leave the card where it is, add a \`**Blocked:**\` line explaining what you
   need, and raise its priority if it's urgent.
6. **Capture new work.** If you discover follow-up tasks, add cards to the first (backlog) column with a
   priority and size instead of silently expanding scope.
7. **Use documents for longer material** — plans, specs, research, decision logs — and mention the document
   title in related cards.
8. **Be conservative with destructive ops.** Don't delete or rename columns, or delete cards and documents you
   didn't create, unless a human asked. Never call \`/import\` unless asked.
9. **Batch related edits** into one \`POST /ops\` request.`;

export function rootLlmsTxt(origin: string): string {
  return `# Kanban

> Real-time shared kanban boards. Each project lives at \`${origin}/p/<name>/<id>\`, and anyone with that URL
> can view and edit it — there are no accounts. Projects have ordered columns (statuses), cards, and a flat list
> of Markdown documents. Edits made through the API appear live in everyone's browser.

**If you were given a project URL** like \`${origin}/p/<name>/<id>\`, fetch
\`${origin}/api/p/<id>/llms.txt\` instead of reading this file further. It contains that project's current
board, the ids you need, and ready-to-run commands.

### Project ids

- The **id** is the last segment of the URL: 22 letters and digits, e.g. \`1pv7XjjQP9gM4BRBqypgrb\`. It is
  **case-sensitive** — copy it exactly.
- It is a compact (base62) encoding of a UUID, and every endpoint also accepts the UUID form
  (\`3c5f5d83-d805-4e41-bba5-7a69e0ea588b\`). Both refer to the same project.
- The \`<name>\` segment is a readable slug of the title that changes when the project is renamed. It is
  ignored, so never use it to look a project up. \`${origin}/p/<id>\` also works.

${cliSection(origin)}

## Concepts

- **Project**: title, description, ordered columns, cards, documents.
- **Column**: \`id\`, \`name\`. A card's status is simply the column it's in.
- **Card**: \`id\`, \`title\`, \`description\` (Markdown), \`priority\` (\`none | low | medium | high\`),
  \`size\` (\`none | xs | s | m | l | xl\`, \`none\` = not estimated yet), \`createdAt\`, \`updatedAt\` (ms since epoch).
- **Document**: \`id\`, \`title\`, \`body\` (Markdown).

## Creating a project

Pick a new random UUID (v4) and send an \`init\` op. Column names can be plain strings. The response
includes the project's \`url\`, which uses the short id.

\`\`\`sh
ID=$(uuidgen | tr A-Z a-z)
curl -s -X POST ${origin}/api/p/$ID/ops -H 'Content-Type: application/json' \\
  -d '{"ops":[{"type":"init","title":"My project","description":"","columns":["Backlog","In progress","Done"]}]}'
\`\`\`

Share that \`url\` with the human so they can watch the board.

${apiReference(`${origin}/api/p/<id>`)}

${WORKING_AGREEMENT}
`;
}

function cardLine(card: Card): string {
  const meta = [
    card.priority !== "none" ? `${card.priority} priority` : null,
    card.size !== "none" ? `size ${card.size.toUpperCase()}` : "no size",
    card.assignee ? `claimed by ${card.assignee}` : null,
    card.description ? "has description" : null,
  ]
    .filter(Boolean)
    .join(", ");
  return `- **#${card.number}** ${oneLine(card.title) || "(untitled)"} _(${meta})_`;
}

export function projectLlmsTxt(doc: Doc, origin: string, projectId: string): string {
  const shortId = toShortId(projectId);
  const base = `${origin}/api/p/${shortId}`;
  const pageUrl = doc.initialized ? `${origin}${projectPath(projectId, doc.title)}` : `${origin}/p/${shortId}`;

  if (!doc.initialized) {
    return `# New kanban project

> This project id hasn't been set up yet. Create it with an \`init\` op, then share ${pageUrl} with the human.

\`\`\`sh
curl -s -X POST ${base}/ops -H 'Content-Type: application/json' \\
  -d '{"ops":[{"type":"init","title":"My project","description":"","columns":["Backlog","In progress","Done"]}]}'
\`\`\`

${apiReference(base)}

${WORKING_AGREEMENT}
`;
  }

  const board = doc.columns
    .map((col) => {
      const cards = col.cardIds.map((id) => doc.cards[id]).filter((c): c is Card => !!c);
      const listed = cards.slice(0, MAX_LISTED_CARDS).map(cardLine);
      if (cards.length > MAX_LISTED_CARDS) {
        listed.push(`- …and ${cards.length - MAX_LISTED_CARDS} more. GET \`${base}\` for the full list.`);
      }
      return `### ${oneLine(col.name) || "(untitled)"} — column \`${col.id}\`, ${cards.length} card${cards.length === 1 ? "" : "s"}\n\n${listed.join("\n") || "_(empty)_"}`;
    })
    .join("\n\n");

  const documents = doc.documentIds
    .map((id) => doc.documents[id])
    .filter((d) => !!d)
    .map((d) => `- \`${d.id}\` ${oneLine(d.title) || "(untitled)"} _(${d.body.length.toLocaleString("en-US")} chars)_`)
    .join("\n");

  const [first, ...rest] = doc.columns;
  const exampleCard = first?.cardIds.map((id) => doc.cards[id]).find(Boolean);
  const middle = rest.length > 1 ? rest[0] : rest[0] ?? first;

  return `# ${oneLine(doc.title) || "Untitled project"}

> Kanban project at ${pageUrl}. Anyone with that link can view and edit; humans may be watching live.${
    doc.description ? `\n>\n> ${doc.description.trim().split("\n").join("\n> ")}` : ""
  }

This file is a snapshot taken ${new Date().toISOString()}. Re-fetch \`${base}/llms.txt\` (or GET \`${base}\` for
full JSON including card descriptions and document bodies) before making decisions.

${cliSection(origin, pageUrl)}

## Board

Columns are listed left to right; cards top to bottom (top = highest in the column's order).

${board}

## Documents

${documents || "_(none yet)_"}

Card descriptions are in the JSON (\`curl -s ${base}\`, look the card up by id). Fetch a document's Markdown with
\`curl -s ${base}/documents/<documentId>\`.

## Quick start

\`\`\`sh
# Read everything
curl -s ${base}

# Add a card${first ? ` to "${oneLine(first.name)}"` : ""}
${curlOps(base, [{ type: "addCard", column: first?.name ?? "Backlog", card: { title: "New task", priority: "medium", size: "s" } }])}
${
  exampleCard && middle
    ? `
# Start a card: move it to the top of "${oneLine(middle.name)}"
${curlOps(base, [{ type: "moveCard", id: exampleCard.id, column: middle.name, index: 0 }])}
`
    : ""
}
# Write a document
${curlOps(base, [{ type: "addDocument", document: { title: "Notes", body: "# Notes\n" } }])}
\`\`\`

${apiReference(base)}

${WORKING_AGREEMENT}
`;
}

/** A single document as Markdown with YAML front matter, for `GET /api/p/<id>/documents/<docId>`. */
export function documentMarkdown(d: ProjectDocument): string {
  return `---
id: ${d.id}
title: ${JSON.stringify(d.title)}
created: ${new Date(d.createdAt).toISOString()}
updated: ${new Date(d.updatedAt).toISOString()}
---

${d.body}
`;
}
