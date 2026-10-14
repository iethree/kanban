import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Download, Ellipsis, Link2, Upload } from "lucide-react";
import { LIMITS } from "../../shared/types";
import { toShortId } from "../../shared/ids";
import { projectPath, type ProjectRoute } from "../../shared/urls";
import { downloadProject, pickJsonFile, uploadProject } from "../lib/files";
import { rememberProject } from "../lib/recent";
import { navigate, useSearchParam } from "../lib/router";
import { useProject, type ConnectionStatus } from "../lib/sync";
import { BoardSkeleton, BoardView } from "./BoardView";
import { CardModal } from "./CardModal";
import { DocumentsView } from "./Documents";
import { SetupDialog } from "./SetupDialog";
import { EditableText, Logo, Menu, MenuItem, MenuSeparator, ThemeToggle } from "./ui";

export type ProjectView = ProjectRoute["view"];

export function ProjectPage({ projectId, view }: { projectId: string; view: ProjectView }) {
  const { doc, status, peers, pendingCount, dispatch } = useProject(projectId);
  const [openCardId, setOpenCardId] = useSearchParam("card");
  const [toast, showToast] = useToast();
  // Until the project loads we don't know its name, so links fall back to the generic slug.
  const base = projectPath(projectId, doc?.title ?? "");
  const viewSuffix = view.kind === "docs" ? `/docs${view.documentId ? `/${view.documentId}` : ""}` : "";

  // Keep the address bar on the canonical /p/<slug>/<uuid> form, e.g. after a rename
  // or when opened via an old link. Replacing (not pushing) keeps history clean.
  useEffect(() => {
    if (!doc?.initialized) return;
    const canonical = projectPath(projectId, doc.title, viewSuffix);
    if (location.pathname !== canonical) history.replaceState(null, "", canonical + location.search);
  }, [projectId, doc?.initialized, doc?.title, viewSuffix]);

  useEffect(() => {
    if (doc?.initialized) rememberProject(projectId, doc.title);
  }, [projectId, doc?.initialized, doc?.title]);

  useEffect(() => {
    document.title = doc?.initialized ? `${doc.title || "Untitled project"} · Kanban` : "Kanban";
    return () => {
      document.title = "Kanban";
    };
  }, [doc?.initialized, doc?.title]);

  const copy = async (text: string, success: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(success);
    } catch {
      showToast("Couldn't copy to the clipboard.");
    }
  };

  const copyLink = () => copy(`${location.origin}${base}`, "Link copied — anyone with it can edit this project.");

  const copyAgentInstructions = () =>
    copy(
      `Use the kanban board at ${location.origin}${base} to plan and track your work. ` +
        `Fetch ${location.origin}/api/p/${toShortId(projectId)}/llms.txt first: it describes the board and the HTTP API for reading and updating it.`,
      "Agent instructions copied. Paste them into your agent's prompt.",
    );

  const importFile = async () => {
    try {
      const file = await pickJsonFile();
      if (!file) return;
      if (!confirm(`Replace everything in this project with “${file.name}”? This affects everyone viewing it.`)) return;
      const imported = await uploadProject(projectId, file.data);
      showToast(`Imported “${imported.title}”.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const openCard = useCallback((id: string) => setOpenCardId(id), [setOpenCardId]);

  const openCardEntry = useMemo(() => {
    if (!doc || !openCardId) return null;
    const card = doc.cards[openCardId];
    const column = doc.columns.find((c) => c.cardIds.includes(openCardId));
    return card && column ? { card, column } : null;
  }, [doc, openCardId]);

  return (
    <div className="board-page">
      <header className="topbar">
        <a
          href="/"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          <Logo />
          <span>Kanban</span>
        </a>
        <span className="crumb-sep">/</span>
        <span className="crumb">{doc?.initialized ? doc.title || "Untitled project" : "New project"}</span>

        <div className="topbar-actions">
          <SyncStatus status={status} peers={peers} pending={pendingCount} />
          <button type="button" className="btn btn-sm" onClick={copyLink} disabled={!doc?.initialized}>
            <Link2 size={14} />
            Share
          </button>
          <ThemeToggle />
          <Menu label="Project options" trigger={<Ellipsis size={16} />}>
            <MenuItem
              icon={<Download size={14} />}
              disabled={!doc?.initialized}
              onSelect={() => doc && downloadProject(doc)}
            >
              Export JSON
            </MenuItem>
            <MenuItem icon={<Upload size={14} />} onSelect={importFile}>
              Import JSON…
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Link2 size={14} />} onSelect={copyLink}>
              Copy link
            </MenuItem>
            <MenuItem icon={<Bot size={14} />} disabled={!doc?.initialized} onSelect={copyAgentInstructions}>
              Copy agent instructions
            </MenuItem>
          </Menu>
        </div>
      </header>

      {!doc ? (
        <BoardSkeleton />
      ) : !doc.initialized ? (
        <>
          <BoardSkeleton still />
          <SetupDialog onSubmit={dispatch} onCancel={() => navigate("/")} />
        </>
      ) : (
        <>
          <div className="project-header">
            <div className="project-heading">
              <EditableText
                value={doc.title}
                placeholder="Untitled project"
                ariaLabel="Project title"
                className="project-title"
                maxLength={LIMITS.title}
                onCommit={(title) => dispatch({ type: "updateProject", title })}
              />
              <EditableText
                value={doc.description}
                placeholder="Add a description…"
                ariaLabel="Project description"
                className="project-description"
                multiline
                maxLength={LIMITS.description}
                onCommit={(description) => dispatch({ type: "updateProject", description })}
              />
            </div>

            <nav className="tabs" aria-label="Project sections">
              <TabLink href={base} active={view.kind === "board"}>
                Board
              </TabLink>
              <TabLink href={`${base}/docs`} active={view.kind === "docs"}>
                Documents
                {doc.documentIds.length > 0 && <span className="tab-count">{doc.documentIds.length}</span>}
              </TabLink>
            </nav>
          </div>

          {view.kind === "board" ? (
            <BoardView doc={doc} dispatch={dispatch} onOpenCard={openCard} />
          ) : (
            <DocumentsView basePath={`${base}/docs`} doc={doc} documentId={view.documentId} dispatch={dispatch} />
          )}
        </>
      )}

      {doc && view.kind === "board" && openCardEntry && (
        <CardModal
          key={openCardEntry.card.id}
          card={openCardEntry.card}
          column={openCardEntry.column}
          columns={doc.columns}
          dispatch={dispatch}
          onClose={() => setOpenCardId(null)}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className={`tab${active ? " is-active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}

function SyncStatus({ status, peers, pending }: { status: ConnectionStatus; peers: number; pending: number }) {
  let tone = "live";
  let label = peers > 1 ? `${peers} online` : "Live";
  let title = peers > 1 ? `${peers} people have this project open` : "Connected. Changes sync in real time.";
  if (status === "connecting") {
    tone = "pending";
    label = "Connecting…";
    title = "Connecting to the project";
  } else if (status === "offline") {
    tone = "offline";
    label = pending > 0 ? `Offline · ${pending} unsaved` : "Offline";
    title = "Reconnecting. Your changes will sync when the connection returns.";
  } else if (pending > 0) {
    tone = "pending";
    label = "Saving…";
  }
  return (
    <span className={`sync sync-${tone}`} title={title} aria-live="polite">
      <span className="sync-dot" />
      {label}
    </span>
  );
}

function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((msg: string) => {
    clearTimeout(timer.current);
    setMessage(msg);
    timer.current = setTimeout(() => setMessage(null), 3200);
  }, []);
  return [message, show] as const;
}
