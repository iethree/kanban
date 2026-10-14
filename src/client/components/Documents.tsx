import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Ellipsis, FileText, Plus, Trash2 } from "lucide-react";
import { LIMITS, type Doc, type Op, type ProjectDocument } from "../../shared/types";
import { newId } from "../../shared/validate";
import { navigate } from "../lib/router";
import { useRemoteDraft } from "../lib/useRemoteDraft";
import { MarkdownField } from "./Markdown";
import { Menu, MenuItem, timeAgo, useAutosize } from "./ui";

export function DocumentsView({
  basePath: base,
  doc,
  documentId,
  dispatch,
}: {
  /** Path of the documents list, e.g. `/p/<slug>/<uuid>/docs`. */
  basePath: string;
  doc: Doc;
  documentId?: string;
  dispatch: (op: Op) => void;
}) {
  const documents = doc.documentIds.map((id) => doc.documents[id]).filter((d): d is ProjectDocument => !!d);
  const selected = documentId ? doc.documents[documentId] : undefined;
  const [createdId, setCreatedId] = useState<string | null>(null);

  // If the open document is deleted (possibly by someone else), fall back to the list.
  useEffect(() => {
    if (documentId && !doc.documents[documentId]) navigate(base, { replace: true });
  }, [documentId, doc.documents, base]);

  const create = () => {
    const id = newId();
    dispatch({ type: "addDocument", document: { id, title: "", body: "" } });
    setCreatedId(id);
    navigate(`${base}/${id}`);
  };

  const atLimit = documents.length >= LIMITS.documents;

  return (
    <div className={`docs${selected ? " has-selection" : ""}${documents.length ? "" : " is-empty"}`}>
      <aside className="docs-sidebar" aria-label="Documents">
        <div className="docs-sidebar-header">
          <span>Documents</span>
          <button type="button" className="icon-btn" title="New document" aria-label="New document" onClick={create} disabled={atLimit}>
            <Plus size={15} />
          </button>
        </div>
        {documents.length > 0 ? (
          <ul className="docs-list">
            {documents.map((d) => (
              <li key={d.id}>
                <a
                  href={`${base}/${d.id}`}
                  className={`docs-item${d.id === documentId ? " is-active" : ""}`}
                  aria-current={d.id === documentId ? "page" : undefined}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                    e.preventDefault();
                    navigate(`${base}/${d.id}`);
                  }}
                >
                  <FileText size={14} className="docs-item-icon" />
                  <span className={`docs-item-title${d.title ? "" : " is-empty"}`}>{d.title || "Untitled"}</span>
                  <span className="docs-item-time">{timeAgo(d.updatedAt)}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="docs-list-empty">No documents yet.</p>
        )}
      </aside>

      <section className="docs-main">
        {selected ? (
          <DocumentEditor
            key={selected.id}
            document={selected}
            isNew={selected.id === createdId}
            backHref={base}
            dispatch={dispatch}
          />
        ) : (
          <div className="docs-placeholder">
            <FileText size={22} />
            <h2>{documents.length ? "Select a document" : "Keep notes alongside the board"}</h2>
            <p>Documents are Markdown pages for specs, plans and meeting notes. Everyone with the link can edit them.</p>
            <button type="button" className="btn btn-primary" onClick={create} disabled={atLimit}>
              <Plus size={15} />
              New document
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function DocumentEditor({
  document: d,
  isNew,
  backHref,
  dispatch,
}: {
  document: ProjectDocument;
  isNew: boolean;
  backHref: string;
  dispatch: (op: Op) => void;
}) {
  const title = useRemoteDraft(d.title, (title) => dispatch({ type: "updateDocument", id: d.id, patch: { title } }));
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useAutosize(titleRef, title.value);

  return (
    <article className="doc-editor">
      <div className="doc-toolbar">
        <a
          href={backHref}
          className="btn btn-ghost btn-sm doc-back"
          onClick={(e) => {
            e.preventDefault();
            navigate(backHref);
          }}
        >
          <ArrowLeft size={14} />
          Documents
        </a>
        <span className="muted doc-updated">Updated {timeAgo(d.updatedAt)}</span>
        <Menu label="Document options" trigger={<Ellipsis size={16} />}>
          <MenuItem
            danger
            icon={<Trash2 size={14} />}
            onSelect={() => {
              if (!confirm(`Delete “${d.title || "Untitled"}”? This can't be undone.`)) return;
              dispatch({ type: "deleteDocument", id: d.id });
              navigate(backHref);
            }}
          >
            Delete document
          </MenuItem>
        </Menu>
      </div>

      <textarea
        ref={titleRef}
        rows={1}
        className="doc-title"
        placeholder="Untitled"
        aria-label="Document title"
        maxLength={LIMITS.title}
        autoFocus={isNew}
        {...title}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      <MarkdownField
        value={d.body}
        onCommit={(body) => dispatch({ type: "updateDocument", id: d.id, patch: { body } })}
        placeholder="Start writing…"
        ariaLabel="Document body"
        maxLength={LIMITS.body}
        className="doc-body"
      />
    </article>
  );
}
