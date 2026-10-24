import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bot, Columns3, FileText, FolderPlus, MessageSquareText, Pencil, Trash2, UserRound } from "lucide-react";
import type { ActivityEntry, Actor, CardRef, ColumnRef } from "../../shared/activity";
import { FALLBACK_ICON, columnIcon, matchColumnIcon } from "../../shared/column-icons";
import type { Doc } from "../../shared/types";
import { apiFetch } from "../lib/keys";
import { navigate } from "../lib/router";
import { Markdown } from "./Markdown";
import { PRIORITY_LABEL, StatusIcon, timeAgo } from "./ui";


/** Keeps entries newest first, replacing any whose seq we already have (merged edits). */
function mergeEntries(current: ActivityEntry[], incoming: ActivityEntry[]): ActivityEntry[] {
  const bySeq = new Map(current.map((e) => [e.seq, e]));
  for (const e of incoming) bySeq.set(e.seq, e);
  return [...bySeq.values()].sort((a, b) => b.seq - a.seq);
}

/** Loads the feed over HTTP, then keeps it current from the project's socket. */
export type SubscribeActivity = (listener: (entries: ActivityEntry[]) => void) => () => void;

/** Loads the newest `page` entries (more on demand) and keeps them current from the socket. */
export function useActivity(projectId: string, subscribe: SubscribeActivity, page = 50) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (before?: number) => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ limit: String(page), ...(before ? { before: String(before) } : {}) });
      const res = await apiFetch(projectId, `/activity?${query}`);
      if (!res.ok) throw new Error(`Couldn't load activity (${res.status}).`);
      const body = (await res.json()) as { entries: ActivityEntry[]; more: boolean };
      setEntries((current) => mergeEntries(current, body.entries));
      setMore(body.more);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setEntries([]);
    // Subscribe first so nothing recorded during the fetch is missed.
    const unsubscribe = subscribe((incoming) => setEntries((current) => mergeEntries(current, incoming)));
    void load();
    return unsubscribe;
  }, [projectId, subscribe]);

  const loadMore = () => {
    const oldest = entries[entries.length - 1];
    if (oldest) void load(oldest.seq);
  };

  return { entries, more, loading, error, loadMore };
}

/** Everything that has happened in the project, newest first, grouped by day. */
export function ActivityView({
  projectId,
  doc,
  basePath,
  subscribeActivity,
  onOpenCard,
}: {
  projectId: string;
  doc: Doc;
  basePath: string;
  subscribeActivity: SubscribeActivity;
  onOpenCard: (id: string) => void;
}) {
  const { entries, more, loading, error, loadMore } = useActivity(projectId, subscribeActivity);
  const days = useMemo(() => groupByDay(entries), [entries]);
  // Re-render every minute so "5m ago" stays true.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const ctx: Ctx = { doc, basePath, onOpenCard };

  return (
    <div className="activity-view">
      {entries.length === 0 && !loading && !error && (
        <div className="activity-empty">Nothing yet. Changes to cards, columns and documents will show up here as they happen.</div>
      )}
      {days.map(([label, items]) => (
        <section key={label} className="activity-day" aria-label={label}>
          <h2 className="activity-day-label">{label}</h2>
          <ol className="activity-list">
            {items.map((entry) => (
              <li key={entry.seq} className="activity-item">
                <span className="activity-icon">{entryIcon(entry, doc)}</span>
                <div className="activity-body">
                  <div className="activity-text">{describe(entry, ctx)}</div>
                  {entry.kind === "card.noted" && <Markdown source={entry.text} className="activity-note" />}
                </div>
                {entry.user && <ActorBadge user={entry.user} />}
                <time className="activity-time" dateTime={new Date(entry.at).toISOString()} title={new Date(entry.at).toLocaleString()}>
                  {timeAgo(entry.at)}
                </time>
              </li>
            ))}
          </ol>
        </section>
      ))}
      {error && <p className="form-error">{error}</p>}
      {loading ? (
        <div className="activity-loading">Loading…</div>
      ) : (
        more && (
          <button type="button" className="btn btn-sm activity-more" onClick={loadMore}>
            Show older activity
          </button>
        )
      )}
    </div>
  );
}

type Ctx = { doc: Doc; basePath: string; onOpenCard: (id: string) => void };

/** Who made the change: someone in the browser ("user") or a client of the HTTP API ("agent"). */
function ActorBadge({ user }: { user: Actor }) {
  const Icon = user === "agent" ? Bot : UserRound;
  return (
    <span
      className={`activity-actor is-${user}`}
      title={user === "agent" ? "Made through the API (CLI, script or AI agent)" : "Made in the browser"}
    >
      <Icon size={12} aria-hidden />
      {user}
    </span>
  );
}

function groupByDay(entries: ActivityEntry[]): [string, ActivityEntry[]][] {
  const groups = new Map<string, ActivityEntry[]>();
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  for (const entry of entries) {
    const day = new Date(entry.at).toDateString();
    const label =
      day === today
        ? "Today"
        : day === yesterday
          ? "Yesterday"
          : new Date(entry.at).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    const list = groups.get(label) ?? [];
    list.push(entry);
    groups.set(label, list);
  }
  return [...groups];
}

/** A column's icon as it looks now, or as its name suggests if it's gone. */
function iconFor(ref: ColumnRef, doc: Doc) {
  const column = doc.columns.find((c) => c.id === ref.id);
  return <StatusIcon icon={column ? columnIcon(column) : (matchColumnIcon(ref.name) ?? FALLBACK_ICON)} />;
}

function entryIcon(entry: ActivityEntry, doc: Doc): ReactNode {
  switch (entry.kind) {
    case "card.created":
    case "card.moved":
      return iconFor(entry.to, doc);
    case "card.edited":
      return <Pencil size={13} />;
    case "card.claimed":
      return <UserRound size={13} />;
    case "card.noted":
      return <MessageSquareText size={13} />;
    case "card.deleted":
    case "column.deleted":
    case "document.deleted":
      return <Trash2 size={13} />;
    case "column.added":
    case "column.renamed":
      return <Columns3 size={13} />;
    case "document.created":
    case "document.edited":
      return <FileText size={13} />;
    case "project.created":
    case "project.renamed":
    case "project.imported":
      return <FolderPlus size={13} />;
  }
}

function CardLink({ card, ctx }: { card: CardRef; ctx: Ctx }) {
  const current = ctx.doc.cards[card.id];
  const label = (
    <>
      <span className="activity-number">#{card.number}</span> {current?.title || card.title || "Untitled"}
    </>
  );
  if (!current) return <span className="activity-card is-gone">{label}</span>;
  return (
    <button type="button" className="activity-card" onClick={() => ctx.onOpenCard(card.id)}>
      {label}
    </button>
  );
}

function DocLink({ document, ctx }: { document: { id: string; title: string }; ctx: Ctx }) {
  const current = ctx.doc.documents[document.id];
  const title = current?.title || document.title || "Untitled";
  if (!current) return <span className="activity-card is-gone">{title}</span>;
  const href = `${ctx.basePath}/docs/${document.id}`;
  return (
    <a
      className="activity-card"
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        navigate(href);
      }}
    >
      {title}
    </a>
  );
}

const Name = ({ children }: { children: ReactNode }) => <strong className="activity-name">{children || "Untitled"}</strong>;

function describe(entry: ActivityEntry, ctx: Ctx): ReactNode {
  switch (entry.kind) {
    case "project.created":
      return (
        <>
          Project <Name>{entry.title}</Name> created
        </>
      );
    case "project.renamed":
      return (
        <>
          Project renamed from <Name>{entry.from}</Name> to <Name>{entry.to}</Name>
        </>
      );
    case "project.imported":
      return (
        <>
          Project replaced by an import of <Name>{entry.title}</Name>
        </>
      );
    case "column.added":
      return (
        <>
          Column <Name>{entry.column.name}</Name> added
        </>
      );
    case "column.renamed":
      return (
        <>
          Column <Name>{entry.from}</Name> renamed to <Name>{entry.column.name}</Name>
        </>
      );
    case "column.deleted":
      return (
        <>
          Column <Name>{entry.column.name}</Name> deleted
          {entry.cards > 0 && ` with ${entry.cards} card${entry.cards === 1 ? "" : "s"}`}
        </>
      );
    case "card.created":
      return (
        <>
          <CardLink card={entry.card} ctx={ctx} /> created in <Name>{entry.to.name}</Name>
        </>
      );
    case "card.moved":
      return (
        <>
          <CardLink card={entry.card} ctx={ctx} /> moved from <Name>{entry.from.name}</Name> to <Name>{entry.to.name}</Name>
        </>
      );
    case "card.edited":
      return (
        <>
          <CardLink card={entry.card} ctx={ctx} /> {describeChanges(entry.changes)}
        </>
      );
    case "card.claimed":
      return (
        <>
          <CardLink card={entry.card} ctx={ctx} /> claimed by <Name>{entry.assignee}</Name>
        </>
      );
    case "card.noted":
      return (
        <>
          Note added to <CardLink card={entry.card} ctx={ctx} />
        </>
      );
    case "card.deleted":
      return (
        <>
          <CardLink card={entry.card} ctx={ctx} /> deleted
          {entry.from && (
            <>
              {" "}
              from <Name>{entry.from.name}</Name>
            </>
          )}
        </>
      );
    case "document.created":
      return (
        <>
          Document <DocLink document={entry.document} ctx={ctx} /> created
        </>
      );
    case "document.edited":
      return (
        <>
          Document <DocLink document={entry.document} ctx={ctx} /> edited
        </>
      );
    case "document.deleted":
      return (
        <>
          Document <DocLink document={entry.document} ctx={ctx} /> deleted
        </>
      );
  }
}

function describeChanges(changes: Extract<ActivityEntry, { kind: "card.edited" }>["changes"]): ReactNode {
  const parts: ReactNode[] = [];
  if (changes.title) parts.push("renamed");
  if (changes.priority) parts.push(<>priority <Name>{PRIORITY_LABEL[changes.priority[1]]}</Name></>);
  if (changes.size) parts.push(<>size <Name>{changes.size[1] === "none" ? "not set" : changes.size[1].toUpperCase()}</Name></>);
  if (changes.assignee) {
    parts.push(changes.assignee[1] ? <>assigned to <Name>{changes.assignee[1]}</Name></> : "unassigned");
  }
  if (changes.description) parts.push("description edited");
  if (!parts.length) return "edited";
  return parts.map((part, i) => (
    <span key={i}>
      {i > 0 && (i === parts.length - 1 ? " and " : ", ")}
      {part}
    </span>
  ));
}
