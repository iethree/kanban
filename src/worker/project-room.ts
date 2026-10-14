import { DurableObject } from "cloudflare:workers";
import { applyOp, emptyDoc } from "../shared/reducer";
import type { ClientMessage, Doc, Op, ServerMessage } from "../shared/types";
import { exportDoc, importDoc, newId, sanitizeOp } from "../shared/validate";
import { documentMarkdown, projectLlmsTxt } from "./llms";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_HTTP_OPS = 100;

type Row = { id: string; data: string };
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * One instance per project. Holds the authoritative document, persists it to
 * SQLite (project metadata in one row, one row per card and per document), and
 * relays ops to every connected browser over hibernatable WebSockets. Agents
 * can make the same edits over plain HTTP via `POST /ops`.
 */
export class ProjectRoom extends DurableObject<Env> {
  private sql: SqlStorage;
  private doc: Doc | null = null;
  private version = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    // Keepalive pings from clients are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // -- persistence ----------------------------------------------------------

  private load(): Doc {
    if (this.doc) return this.doc;
    const meta = new Map(
      this.sql.exec<{ key: string; value: string }>(`SELECT key, value FROM meta`).toArray().map((r) => [r.key, r.value]),
    );
    const project = meta.get("project");
    this.version = Number(meta.get("version") ?? 0);
    if (!project) return (this.doc = emptyDoc());
    const rows = (table: string) =>
      Object.fromEntries(this.sql.exec<Row>(`SELECT id, data FROM ${table}`).toArray().map((r) => [r.id, JSON.parse(r.data)]));
    const doc: Doc = {
      // Defaults for projects saved before documents existed.
      documentIds: [],
      ...JSON.parse(project),
      cards: rows("cards"),
      documents: rows("documents"),
    };
    this.doc = doc;
    return doc;
  }

  /** Writes rows whose object identity changed; the reducer leaves untouched entries as-is. */
  private syncTable<T>(table: string, prev: Record<string, T>, next: Record<string, T>) {
    if (prev === next) return;
    for (const [id, value] of Object.entries(next)) {
      if (prev[id] !== value) this.sql.exec(`INSERT OR REPLACE INTO ${table} (id, data) VALUES (?, ?)`, id, JSON.stringify(value));
    }
    for (const id of Object.keys(prev)) {
      if (!next[id]) this.sql.exec(`DELETE FROM ${table} WHERE id = ?`, id);
    }
  }

  private save(prev: Doc, next: Doc) {
    this.version++;
    this.ctx.storage.transactionSync(() => {
      const { cards, documents, ...project } = next;
      this.sql.exec(`INSERT OR REPLACE INTO meta (key, value) VALUES ('project', ?)`, JSON.stringify(project));
      this.sql.exec(`INSERT OR REPLACE INTO meta (key, value) VALUES ('version', ?)`, String(this.version));
      this.syncTable("cards", prev.cards, cards);
      this.syncTable("documents", prev.documents, documents);
    });
    this.doc = next;
  }

  /** Applies a validated op, persists and broadcasts it. Returns whether anything changed. */
  private commit(op: Op, opId: string): boolean {
    const at = Date.now();
    const prev = this.load();
    const next = applyOp(prev, op, at);
    if (next === prev) return false;
    this.save(prev, next);
    this.broadcast({ t: "op", opId, op, at, version: this.version });
    return true;
  }

  // -- networking -----------------------------------------------------------

  private peers(exclude?: WebSocket): number {
    return this.ctx.getWebSockets().filter((ws) => ws !== exclude && ws.readyState === WebSocket.OPEN).length;
  }

  private broadcast(msg: ServerMessage, exclude?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      try {
        ws.send(data);
      } catch {
        // Socket is closing; its close handler will clean up.
      }
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const [, , , projectId, action = "", itemId] = url.pathname.split("/");

    switch (action) {
      case "ws": {
        const { 0: client, 1: server } = new WebSocketPair();
        this.ctx.acceptWebSocket(server);
        const doc = this.load();
        const peers = this.peers();
        server.send(JSON.stringify({ t: "init", doc, version: this.version, peers } satisfies ServerMessage));
        this.broadcast({ t: "presence", peers }, server);
        return new Response(null, { status: 101, webSocket: client });
      }

      case "":
      case "export": {
        const doc = this.load();
        if (!doc.initialized) return notFound();
        return Response.json(exportDoc(doc));
      }

      case "llms.txt": {
        const doc = this.load();
        return new Response(projectLlmsTxt(doc, url.origin, projectId!), {
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
        });
      }

      case "documents": {
        const doc = this.load();
        const document = itemId ? doc.documents[itemId] : undefined;
        if (!doc.initialized || !document) {
          return new Response("Document not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }
        return new Response(documentMarkdown(document), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
      }

      case "ops":
        return this.handleOps(request);

      case "import": {
        const length = Number(request.headers.get("Content-Length") ?? 0);
        if (length > MAX_IMPORT_BYTES) return Response.json({ error: "File too large" }, { status: 413 });
        let next: Doc;
        try {
          next = importDoc(await request.json());
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : "Invalid JSON" }, { status: 400 });
        }
        const prev = this.load();
        if (prev.initialized) next.createdAt = prev.createdAt;
        this.save(prev, next);
        this.broadcast({ t: "reset", doc: next, version: this.version });
        return Response.json({ ok: true });
      }
    }

    return new Response("Not found", { status: 404 });
  }

  /**
   * HTTP batch edits for agents and scripts. Accepts `{ ops: [...] }`, a bare
   * array, or a single op. All ops are validated before any are applied. Ids
   * for new columns/cards/documents are generated when omitted, and cards can
   * name their column with `column` instead of `columnId`.
   */
  private async handleOps(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Body must be JSON: {\"ops\": [...]}");
    }
    const rawOps = Array.isArray(body) ? body : isObj(body) && Array.isArray(body.ops) ? body.ops : [body];
    if (rawOps.length === 0) return badRequest("No ops given.");
    if (rawOps.length > MAX_HTTP_OPS) return badRequest(`At most ${MAX_HTTP_OPS} ops per request.`);

    const doc = this.load();
    if (!doc.initialized && !(isObj(rawOps[0]) && rawOps[0].type === "init")) {
      return notFound();
    }

    // Validate against a scratch copy so later ops can refer to things created
    // earlier in the same batch (e.g. init, then addCard by column name).
    const ops: Op[] = [];
    let scratch = doc;
    for (const [i, raw] of rawOps.entries()) {
      const prepared = this.prepareOp(raw, scratch);
      if (typeof prepared === "string") return badRequest(`ops[${i}]: ${prepared}`);
      const op = sanitizeOp(prepared);
      if (!op) return badRequest(`ops[${i}] is not a valid op. See /llms.txt for the op reference.`);
      ops.push(op);
      scratch = applyOp(scratch, op, Date.now());
    }

    const results = ops.map((op) => ({ type: op.type, id: opTargetId(op), changed: this.commit(op, `http-${newId()}`) }));
    return Response.json({ ok: true, version: this.version, results });
  }

  /** Fills in conveniences for HTTP callers. Returns an error message for unresolvable references. */
  private prepareOp(raw: unknown, doc: Doc): unknown {
    if (!isObj(raw)) return raw;
    const op = { ...raw };
    if (op.type === "addCard" || op.type === "moveCard") {
      if (op.columnId === undefined && typeof op.column === "string") {
        const name = op.column.trim().toLowerCase();
        const column = doc.columns.find((c) => c.name.trim().toLowerCase() === name);
        if (!column) return `no column named "${op.column}"`;
        op.columnId = column.id;
      }
    }
    if (op.type === "addCard" && isObj(op.card) && op.card.id === undefined) op.card = { ...op.card, id: newId() };
    if (op.type === "addDocument" && isObj(op.document) && op.document.id === undefined)
      op.document = { ...op.document, id: newId() };
    if (op.type === "addColumn" && op.id === undefined) op.id = newId();
    if (op.type === "init" && Array.isArray(op.columns)) {
      op.columns = op.columns.map((c) => (typeof c === "string" ? { id: newId(), name: c } : isObj(c) && c.id === undefined ? { ...c, id: newId() } : c));
    }
    if (op.type === "init") {
      op.title ??= "Untitled project";
      op.description ??= "";
    }
    return op;
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string") return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg?.t !== "op" || typeof msg.opId !== "string") return;

    const opId = msg.opId.slice(0, 64);
    const op = sanitizeOp(msg.op);
    // Invalid or no-op ops are acked back so the sender drops them from its pending queue.
    if (!op || !this.commit(op, opId)) ws.send(JSON.stringify({ t: "ack", opId } satisfies ServerMessage));
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
    this.broadcast({ t: "presence", peers: this.peers(ws) }, ws);
  }

  override async webSocketError(ws: WebSocket) {
    this.broadcast({ t: "presence", peers: this.peers(ws) }, ws);
  }
}

function opTargetId(op: Op): string | undefined {
  switch (op.type) {
    case "init":
    case "updateProject":
      return undefined;
    case "addCard":
      return op.card.id;
    case "addDocument":
      return op.document.id;
    default:
      return op.id;
  }
}

const badRequest = (error: string) => Response.json({ ok: false, error }, { status: 400 });
const notFound = () =>
  Response.json(
    { ok: false, error: "Project not found. Create it by POSTing an init op to /ops (see /llms.txt)." },
    { status: 404 },
  );
