import { DurableObject } from "cloudflare:workers";
import { describeOp, mergeActivity, type ActivityEntry, type ActivityEvent, type Actor } from "../shared/activity";
import { randomProjectColor } from "../shared/colors";
import { needsGuess } from "../shared/column-icons";
import { applyOp, claimConflict, emptyDoc, normalizeDoc, resolveCardRef } from "../shared/reducer";
import type { ClientMessage, Doc, Op, ServerMessage } from "../shared/types";
import { KEY_CLOSE_CODE, KEY_HEADER, KEY_RE, generateKey, hashKey, keyHint, type KeyInfo } from "../shared/keys";
import { exportDoc, importDoc, newId, sanitizeOp } from "../shared/validate";
import { projectPath } from "../shared/urls";
import { guessColumnIcons } from "./icon-guess";
import { documentMarkdown, projectLlmsTxt } from "./llms";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_HTTP_OPS = 100;
/** Activity rows kept per project; older ones are pruned. */
const MAX_ACTIVITY = 10_000;

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
  /** `columnId:name` pairs with a guess in flight, so repeated triggers don't ask twice. */
  private guessing = new Set<string>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS activity (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, data TEXT NOT NULL)`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS keys (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, hint TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    );
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
    const stored: Doc = { ...JSON.parse(project), cards: rows("cards"), documents: rows("documents") };
    // Projects saved by older versions lack card numbers etc. Fill them in once and persist,
    // so numbers stay stable across reloads.
    const doc = normalizeDoc(stored);
    if (doc !== stored) this.persist(emptyDoc(), doc);
    this.doc = doc;
    this.guessIcons();
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
    this.persist(prev, next);
    this.doc = next;
  }

  private persist(prev: Doc, next: Doc) {
    this.ctx.storage.transactionSync(() => {
      const { cards, documents, ...project } = next;
      this.sql.exec(`INSERT OR REPLACE INTO meta (key, value) VALUES ('project', ?)`, JSON.stringify(project));
      this.sql.exec(`INSERT OR REPLACE INTO meta (key, value) VALUES ('version', ?)`, String(this.version));
      this.syncTable("cards", prev.cards, cards);
      this.syncTable("documents", prev.documents, documents);
    });
  }

  // -- activity -------------------------------------------------------------

  /**
   * Writes feed entries attributed to `user` (merging bursts of edits by the
   * same actor into the latest row) and pushes them to browsers.
   */
  private record(events: ActivityEvent[], at: number, user: Actor) {
    if (!events.length) return;
    const written: ActivityEntry[] = [];
    for (const event of events) {
      const last = this.latestActivity();
      const merged = last && mergeActivity(last, event, at, user);
      if (merged) {
        const { seq, ...data } = merged;
        this.sql.exec(`UPDATE activity SET at = ?, data = ? WHERE seq = ?`, at, JSON.stringify(data), seq);
        written.push(merged);
        continue;
      }
      const data = { ...event, at, user };
      const seq = this.sql
        .exec<{ seq: number }>(`INSERT INTO activity (at, data) VALUES (?, ?) RETURNING seq`, at, JSON.stringify(data))
        .one().seq;
      if (seq % 500 === 0) this.sql.exec(`DELETE FROM activity WHERE seq <= ?`, seq - MAX_ACTIVITY);
      written.push({ ...data, seq } as ActivityEntry);
    }
    this.broadcast({ t: "activity", entries: written });
  }

  private latestActivity(): ActivityEntry | null {
    const row = this.sql.exec<{ seq: number; data: string }>(`SELECT seq, data FROM activity ORDER BY seq DESC LIMIT 1`).toArray()[0];
    return row ? { ...JSON.parse(row.data), seq: row.seq } : null;
  }

  /** Newest first, `limit` entries older than `before` (a seq), for the feed and stats. */
  private activityPage(before: number, limit: number): { entries: ActivityEntry[]; more: boolean } {
    const rows = this.sql
      .exec<{ seq: number; data: string }>(`SELECT seq, data FROM activity WHERE seq < ? ORDER BY seq DESC LIMIT ?`, before, limit + 1)
      .toArray();
    return {
      entries: rows.slice(0, limit).map((r) => ({ ...JSON.parse(r.data), seq: r.seq })),
      more: rows.length > limit,
    };
  }

  /**
   * Applies a validated op, persists and broadcasts it, and records it in the
   * activity feed as done by `user`. Returns whether anything changed.
   */
  private commit(op: Op, opId: string, user: Actor): boolean {
    const at = Date.now();
    const prev = this.load();
    const next = applyOp(prev, op, at);
    if (next === prev) return false;
    this.save(prev, next);
    this.broadcast({ t: "op", opId, op, at, version: this.version });
    this.record(describeOp(prev, next, op), at, user);
    if (op.type === "init" || op.type === "addColumn" || op.type === "renameColumn" || op.type === "setColumnIcon") {
      this.guessIcons();
    }
    return true;
  }

  /**
   * Asks the model for an icon for each column whose name no rule recognises,
   * then records the answers as ops so every browser picks them up. Runs in the
   * background; a failure just leaves the fallback icon until the next try.
   */
  private guessIcons() {
    const key = this.env.JEV_API_KEY;
    const doc = this.doc;
    if (!key || !doc?.initialized) return;
    const targets = doc.columns.filter((c) => needsGuess(c) && !this.guessing.has(`${c.id}:${c.name}`));
    if (!targets.length) return;
    const tags = targets.map((c) => `${c.id}:${c.name}`);
    for (const tag of tags) this.guessing.add(tag);
    const work = guessColumnIcons(key, doc, targets)
      .then((guesses) => {
        for (const column of targets) {
          const icon = guesses.get(column.id);
          // Icon guesses don't appear in the feed; they're automated, so count them as the agent's.
          if (icon) this.commit({ type: "guessColumnIcon", id: column.id, name: column.name, icon }, `guess-${newId()}`, "agent");
        }
      })
      .catch((err) => console.error("Column icon guess failed:", err))
      .finally(() => {
        for (const tag of tags) this.guessing.delete(tag);
      });
    this.ctx.waitUntil(work);
  }

  // -- keys -----------------------------------------------------------------

  private hasKeys(): boolean {
    return this.sql.exec(`SELECT 1 FROM keys LIMIT 1`).toArray().length > 0;
  }

  /**
   * Checks the request's key. Open projects (no keys) let everyone in with `keyId: null`;
   * otherwise returns the matching key's id, or why access is refused.
   */
  private async authorize(request: Request): Promise<KeyCheck> {
    const bearer = request.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    return this.checkKey(request.headers.get(KEY_HEADER) ?? bearer ?? null);
  }

  /** Keys are never accepted in URLs, where they'd be shared along with the link. */
  private async checkKey(given: string | null): Promise<KeyCheck> {
    if (!this.hasKeys()) return { keyId: null };
    if (!given) return { denied: "required" };
    if (!KEY_RE.test(given)) return { denied: "invalid" };
    const row = this.sql.exec<{ id: string }>(`SELECT id FROM keys WHERE hash = ?`, await hashKey(given)).toArray()[0];
    return row ? { keyId: row.id } : { denied: "invalid" };
  }

  private listKeys(currentId: string | null): KeyInfo[] {
    return this.sql
      .exec<{ id: string; hint: string; created_at: number }>(`SELECT id, hint, created_at FROM keys ORDER BY created_at`)
      .toArray()
      .map((r) => ({ id: r.id, hint: r.hint, createdAt: r.created_at, current: r.id === currentId }));
  }

  /** Sends a socket that's allowed in the project and tells everyone else it arrived. */
  private welcome(ws: WebSocket, keyId: string | null) {
    ws.serializeAttachment({ keyId } satisfies SocketState);
    const peers = this.peers();
    ws.send(JSON.stringify({ t: "init", doc: this.load(), version: this.version, peers } satisfies ServerMessage));
    this.broadcast({ t: "presence", peers }, ws);
  }

  /** Disconnects browsers that no longer have access, so they ask for a key. */
  private closeSockets(keep: (keyId: string | null) => boolean, reason: "required" | "invalid") {
    for (const ws of this.ctx.getWebSockets()) {
      const keyId = socketState(ws).keyId ?? null;
      if (keep(keyId)) continue;
      try {
        ws.close(KEY_CLOSE_CODE, reason);
      } catch {
        // Already closing.
      }
    }
  }

  private async handleKeys(request: Request, keyId: string | null, itemId: string | undefined): Promise<Response> {
    if (request.method === "GET" || request.method === "HEAD") return Response.json({ keys: this.listKeys(keyId) });

    if (request.method === "POST") {
      if (!this.load().initialized) return notFound();
      const first = !this.hasKeys();
      const key = generateKey();
      const info = { id: newId(), hint: keyHint(key), createdAt: Date.now() };
      this.sql.exec(`INSERT INTO keys (id, hash, hint, created_at) VALUES (?, ?, ?, ?)`, info.id, await hashKey(key), info.hint, info.createdAt);
      // The project was open until now, so everyone connected came in without a key.
      if (first) this.closeSockets(() => false, "required");
      return Response.json({ ok: true, key, ...info }, { status: 201 });
    }

    // DELETE /keys/<id>
    if (!itemId) return badRequest("Name the key to revoke: DELETE /keys/<id>.");
    if (itemId === keyId) {
      return Response.json({ ok: false, error: "You can't revoke the key you're using. Use another key to revoke this one." }, { status: 409 });
    }
    const removed = this.sql.exec(`DELETE FROM keys WHERE id = ? RETURNING id`, itemId).toArray().length > 0;
    if (!removed) return Response.json({ ok: false, error: `No key with id "${itemId}".` }, { status: 404 });
    this.closeSockets((id) => id !== itemId, "invalid");
    return Response.json({ ok: true, revoked: itemId });
  }

  // -- networking -----------------------------------------------------------

  /** Sockets that may see the project: everyone on an open project, and those that sent a valid key. */
  private members(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => !socketState(ws).waiting);
  }

  private peers(exclude?: WebSocket): number {
    return this.members().filter((ws) => ws !== exclude && ws.readyState === WebSocket.OPEN).length;
  }

  private broadcast(msg: ServerMessage, exclude?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const ws of this.members()) {
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

    if (action === "ws") {
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server);
      // Browsers can't set headers on a WebSocket, and a key must never go in a URL, so on a
      // protected project the socket waits for an "auth" message with the key.
      if (this.hasKeys()) server.serializeAttachment({ waiting: true } satisfies SocketState);
      else this.welcome(server, null);
      return new Response(null, { status: 101, webSocket: client });
    }

    const auth = await this.authorize(request);
    if ("denied" in auth) return keyDenied(auth.denied);

    switch (action) {
      case "keys":
        return this.handleKeys(request, auth.keyId, itemId);


      case "":
      case "export": {
        const doc = this.load();
        if (!doc.initialized) return notFound();
        return Response.json(exportDoc(doc));
      }

      case "llms.txt": {
        const doc = this.load();
        return new Response(projectLlmsTxt(doc, url.origin, projectId!, this.hasKeys()), {
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

      case "activity": {
        const doc = this.load();
        if (!doc.initialized) return notFound();
        const before = Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER;
        const limit = Math.max(1, Math.min(MAX_ACTIVITY, Math.floor(Number(url.searchParams.get("limit")) || 50)));
        return Response.json(this.activityPage(before, limit));
      }

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
        this.record([{ kind: "project.imported", title: next.title }], Date.now(), actorOf(request));
        this.guessIcons();
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
      if (op.type === "claimCard") {
        const card = scratch.cards[op.id];
        const holder = card && claimConflict(card, op);
        if (card && holder) {
          return Response.json(
            {
              ok: false,
              error: `Card #${card.number} is already claimed by "${holder}". Pick another card, or pass "force": true to take it over.`,
              conflict: { card: card.number, assignee: holder },
            },
            { status: 409 },
          );
        }
      }
      ops.push(op);
      scratch = applyOp(scratch, op, Date.now());
    }

    const results = ops.map((op) => {
      const id = opTargetId(op);
      // Everything sent to the HTTP API is attributed to "agent".
      const changed = this.commit(op, `http-${newId()}`, "agent");
      const number = id ? this.load().cards[id]?.number : undefined;
      return { type: op.type, id, ...(number ? { number } : {}), changed };
    });
    const { origin, pathname } = new URL(request.url);
    const url = `${origin}${projectPath(pathname.split("/")[3]!, this.load().title)}`;
    return Response.json({ ok: true, version: this.version, url, results });
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
    if (CARD_OPS.has(String(op.type)) && (typeof op.id === "number" || typeof op.id === "string")) {
      const id = resolveCardRef(doc, op.id);
      if (id === null) return `no card #${String(op.id).replace("#", "")}`;
      op.id = id;
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
      op.color ??= randomProjectColor();
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
    if (msg?.t === "auth") {
      // Only a socket still waiting for its key needs one; on an open project it's ignored.
      if (!socketState(ws).waiting) return;
      const auth = await this.checkKey(typeof msg.key === "string" ? msg.key : null);
      if ("denied" in auth) ws.close(KEY_CLOSE_CODE, auth.denied);
      else this.welcome(ws, auth.keyId);
      return;
    }
    if (socketState(ws).waiting) return;
    if (msg?.t !== "op" || typeof msg.opId !== "string") return;

    const opId = msg.opId.slice(0, 64);
    const op = sanitizeOp(msg.op);
    // Invalid or no-op ops are acked back so the sender drops them from its pending queue.
    // Edits over the socket come from the browser app, so they're the user's.
    if (!op || !this.commit(op, opId, "user")) ws.send(JSON.stringify({ t: "ack", opId } satisfies ServerMessage));
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

type KeyCheck = { keyId: string | null } | { denied: "required" | "invalid" };

/** What a socket is allowed to see: `waiting` until it sends a valid key, then the key's id (null on an open project). */
type SocketState = { keyId?: string | null; waiting?: boolean };
const socketState = (ws: WebSocket): SocketState => (ws.deserializeAttachment() as SocketState | null) ?? {};

/**
 * Who sent an HTTP request that isn't an op batch (currently only /import).
 * The browser app marks its own uploads with `X-Kanban-Actor: user`; anything
 * else over HTTP is treated as an agent.
 */
const actorOf = (request: Request): Actor => (request.headers.get("X-Kanban-Actor") === "user" ? "user" : "agent");

/** Ops whose `id` is a card, which HTTP callers may give as a card number (12 or "#12"). */
const CARD_OPS = new Set(["updateCard", "moveCard", "deleteCard", "claimCard", "appendToCard"]);

const keyDenied = (reason: "required" | "invalid") =>
  Response.json(
    {
      ok: false,
      code: reason === "required" ? "key_required" : "key_invalid",
      error:
        reason === "required"
          ? `This project is protected by a key. Send it in the ${KEY_HEADER} header.`
          : "That key isn't valid for this project. It may have been revoked.",
    },
    { status: 401 },
  );

const badRequest = (error: string) => Response.json({ ok: false, error }, { status: 400 });
const notFound = () =>
  Response.json(
    {
      ok: false,
      error: 'Project not found. Create it with `kanban new "Title"`, or by POSTing an init op to /ops (see /llms.txt).',
    },
    { status: 404 },
  );
