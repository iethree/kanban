import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { DEFAULT_COLUMNS, LIMITS, type Op } from "../../shared/types";
import { newId } from "../../shared/validate";
import { Modal } from "./ui";

export function SetupDialog({ onSubmit, onCancel }: { onSubmit: (op: Op) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [columns, setColumns] = useState(() => DEFAULT_COLUMNS.map((name) => ({ id: newId(), name })));
  const [addedId, setAddedId] = useState<string | null>(null);

  const update = (id: string, name: string) => setColumns((cols) => cols.map((c) => (c.id === id ? { ...c, name } : c)));
  const remove = (id: string) => setColumns((cols) => cols.filter((c) => c.id !== id));
  const move = (index: number, delta: number) =>
    setColumns((cols) => {
      const next = cols.slice();
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item!);
      return next;
    });

  const valid = columns.filter((c) => c.name.trim());

  return (
    <Modal open onClose={onCancel} className="setup-modal">
      <form
        className="modal-panel"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            type: "init",
            title: title.trim() || "Untitled project",
            description: description.trim(),
            columns: valid.map((c) => ({ id: c.id, name: c.name.trim() })),
          });
        }}
      >
        <div className="modal-header">
          <h2>New project</h2>
          <p>Anyone with the link can view and edit this project.</p>
        </div>

        <label className="field">
          <span>Title</span>
          <input
            autoFocus
            value={title}
            maxLength={LIMITS.title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled project"
          />
        </label>

        <label className="field">
          <span>
            Description <em>optional</em>
          </span>
          <textarea
            rows={2}
            value={description}
            maxLength={LIMITS.description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this board for?"
          />
        </label>

        <div className="field">
          <span>Columns</span>
          <ol className="setup-columns">
            {columns.map((c, i) => (
              <li key={c.id}>
                <span className="setup-index">{i + 1}</span>
                <input
                  autoFocus={c.id === addedId}
                  value={c.name}
                  maxLength={LIMITS.name}
                  onChange={(e) => update(c.id, e.target.value)}
                  placeholder="Column name"
                  aria-label={`Column ${i + 1} name`}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Move up"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Move down"
                  disabled={i === columns.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={14} />
                </button>
                <button type="button" className="icon-btn" aria-label="Remove column" onClick={() => remove(c.id)}>
                  <X size={14} />
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="btn btn-ghost btn-sm add-row"
            disabled={columns.length >= LIMITS.columns}
            onClick={() => {
              const id = newId();
              setAddedId(id);
              setColumns((cols) => [...cols, { id, name: "" }]);
            }}
          >
            <Plus size={14} />
            Add column
          </button>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={valid.length === 0}>
            Create project
          </button>
        </div>
      </form>
    </Modal>
  );
}
