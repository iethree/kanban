import { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { LIMITS, PRIORITIES, SIZES, type Card, type CardFields, type Column, type Op } from "../../shared/types";
import { useRemoteDraft } from "../lib/useRemoteDraft";
import { MarkdownField } from "./Markdown";
import { Modal, PRIORITY_LABEL, PriorityIcon, timeAgo, useAutosize } from "./ui";

export function CardModal({
  card,
  column,
  columns,
  dispatch,
  onClose,
}: {
  card: Card;
  column: Column;
  columns: Column[];
  dispatch: (op: Op) => void;
  onClose: () => void;
}) {
  const update = (patch: Partial<CardFields>) => dispatch({ type: "updateCard", id: card.id, patch });
  const title = useRemoteDraft(card.title, (title) => update({ title }));
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useAutosize(titleRef, title.value);

  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  return (
    <Modal open onClose={onClose} className="card-modal">
      <div className="modal-panel">
        <button type="button" className="icon-btn card-modal-close" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>

        <div className="card-modal-body">
          <div className="card-modal-main">
            <textarea
              ref={titleRef}
              rows={1}
              className="card-modal-title"
              placeholder="Card title"
              aria-label="Card title"
              maxLength={LIMITS.title}
              autoFocus={!card.title}
              {...title}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
            <MarkdownField
              value={card.description}
              onCommit={(description) => update({ description })}
              placeholder="Add a description…"
              ariaLabel="Description"
              maxLength={LIMITS.description}
              className="card-modal-desc"
            />
          </div>

          <aside className="card-modal-side">
            <div className="side-field">
              <span className="side-label">Status</span>
              <select
                className="select"
                value={column.id}
                aria-label="Status"
                onChange={(e) => dispatch({ type: "moveCard", id: card.id, columnId: e.target.value, index: 0 })}
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || "Untitled"}
                  </option>
                ))}
              </select>
            </div>

            <div className="side-field">
              <span className="side-label">Priority</span>
              <div className="segmented segmented-priority" role="radiogroup" aria-label="Priority">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={card.priority === p}
                    aria-label={PRIORITY_LABEL[p]}
                    data-tooltip={PRIORITY_LABEL[p]}
                    className={card.priority === p ? "is-active" : ""}
                    onClick={() => update({ priority: p })}
                  >
                    <PriorityIcon priority={p} />
                  </button>
                ))}
              </div>
            </div>

            <div className="side-field">
              <span className="side-label">Size</span>
              <div className="segmented segmented-size" role="radiogroup" aria-label="Size">
                {SIZES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={card.size === s}
                    aria-label={s === "none" ? "No size" : s.toUpperCase()}
                    data-tooltip={s === "none" ? "No size" : undefined}
                    className={`mono${card.size === s ? " is-active" : ""}`}
                    onClick={() => update({ size: s })}
                  >
                    {s === "none" ? "–" : s.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="side-footer">
              <div className="side-meta">
                <span>Created {timeAgo(card.createdAt)}</span>
                {card.updatedAt - card.createdAt > 1000 && <span>Updated {timeAgo(card.updatedAt)}</span>}
              </div>
              <button
                type="button"
                className={`btn btn-sm side-delete ${confirmDelete ? "btn-danger" : "btn-ghost"}`}
                onClick={() => {
                  if (!confirmDelete) return setConfirmDelete(true);
                  dispatch({ type: "deleteCard", id: card.id });
                  onClose();
                }}
              >
                <Trash2 size={14} />
                {confirmDelete ? "Click to confirm" : "Delete card"}
              </button>
            </div>
          </aside>
        </div>
      </div>
    </Modal>
  );
}
