import { useEffect, useState } from "react";
import { Copy, KeyRound, Plus } from "lucide-react";
import { KEY_RE, type KeyInfo, type PublicAccess } from "../../shared/keys";
import { createKey, getAccess, getKey, listKeys, revokeKey, setAccess, setKey } from "../lib/keys";
import { Modal, timeAgo } from "./ui";

type KeyProblem = "required" | "invalid" | null;

/** The key field and its checks, shared by the locked page and the read-only viewer's dialog. */
function KeyForm({
  projectId,
  title,
  intro,
  submitLabel,
  onKey,
  onCancel,
}: {
  projectId: string;
  title: string;
  intro: string;
  submitLabel: string;
  onKey: () => void;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="modal-panel key-prompt-panel"
      onSubmit={(e) => {
        e.preventDefault();
        const key = value.trim();
        if (!KEY_RE.test(key)) return setError("A key is 16 letters and digits.");
        setError(null);
        setKey(projectId, key);
        onKey();
      }}
    >
      <div className="modal-header">
        <h2>
          <KeyRound size={18} /> {title}
        </h2>
        <p>{intro}</p>
      </div>
      <label className="field">
        <span>Key</span>
        <input
          autoFocus
          className="key-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          maxLength={64}
        />
      </label>
      {error && <p className="key-error">{error}</p>}
      <div className="modal-footer">
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={!value.trim()}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

const INVALID_KEY = "That key doesn't work for this project. It may have been revoked. Enter another key.";

/** Shown instead of the board when the project needs a key this browser doesn't have. */
export function KeyPrompt({ projectId, problem, onKey }: { projectId: string; problem: KeyProblem; onKey: () => void }) {
  return (
    <div className="key-prompt">
      <KeyForm
        projectId={projectId}
        title="This project needs a key"
        intro={
          problem === "invalid"
            ? INVALID_KEY
            : "The project's owners protected it with keys. Enter a key to open it. Anyone who can open the project can create one for you, from Keys… in the project menu."
        }
        submitLabel="Open project"
        onKey={onKey}
      />
    </div>
  );
}

/** For someone viewing a read-only project: enter a key to be able to edit it. */
export function EnterKeyDialog({
  projectId,
  problem,
  onKey,
  onClose,
}: {
  projectId: string;
  problem: KeyProblem;
  onKey: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} className="key-modal">
      <KeyForm
        projectId={projectId}
        title="Edit this project"
        intro={
          problem === "invalid"
            ? INVALID_KEY
            : "People without a key can only look at this project. Enter a key to edit it. Anyone who can edit the project can create one for you, from Keys… in the project menu."
        }
        submitLabel="Use key"
        onKey={onKey}
        onCancel={onClose}
      />
    </Modal>
  );
}

/** Lists, creates and revokes a project's keys. */
export function KeysDialog({
  projectId,
  onClose,
  onCopy,
}: {
  projectId: string;
  onClose: () => void;
  onCopy: (text: string, success: string) => void;
}) {
  const [keys, setKeys] = useState<KeyInfo[] | null>(null);
  const [created, setCreated] = useState<{ key: string; first: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [access, setAccessState] = useState<PublicAccess | null>(null);

  const refresh = () =>
    Promise.all([listKeys(projectId), getAccess(projectId)])
      .then(([keys, access]) => {
        setKeys(keys);
        setAccessState(access.publicAccess);
      })
      .catch((err: Error) => setError(err.message));

  const changeAccess = (next: PublicAccess) =>
    run(async () => {
      const res = await setAccess(projectId, next);
      setAccessState(res.publicAccess);
    });

  useEffect(() => {
    void refresh();
  }, [projectId]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const first = keys?.length === 0;
      const res = await createKey(projectId);
      // The first key locks the project, so this browser has to start using it straight away.
      if (first || !getKey(projectId)) setKey(projectId, res.key);
      setCreated({ key: res.key, first });
      await refresh();
    });

  const revoke = (key: KeyInfo) => {
    if (!confirm(`Revoke the key that starts with “${key.hint}”? Anyone who uses it loses access immediately.`)) return;
    void run(async () => {
      await revokeKey(projectId, key.id);
      await refresh();
    });
  };

  return (
    <Modal open onClose={onClose} className="keys-modal">
      <div className="modal-panel">
        <div className="modal-header">
          <h2>Keys</h2>
          <p>
            {keys?.length
              ? access === "read"
                ? "Anyone with the link can view this project, and people need one of these keys to edit it. Revoke a key to take access away from everyone who uses it."
                : "People need the link and one of these keys to open this project. Revoke a key to take access away from everyone who uses it."
              : "At the moment anyone with the link can open and edit this project. Create a key to protect it: after that, people need the link and a key."}
          </p>
        </div>

        {created && (
          <div className="key-created">
            <code className="key-value">{created.key}</code>
            <p>
              {created.first
                ? "The project is now protected, and this browser uses this key. "
                : "Give this key to the person who needs it, separately from the link. "}
              You can't see this key again after you close this dialog.
            </p>
            <div className="key-created-actions">
              <button type="button" className="btn btn-sm" onClick={() => onCopy(created.key, "Key copied.")}>
                <Copy size={14} /> Copy key
              </button>
            </div>
          </div>
        )}

        {keys && keys.length > 0 && (
          <ul className="key-list">
            {keys.map((key) => (
              <li key={key.id}>
                <code className="key-hint">{key.hint}••••••••••••</code>
                <span className="key-meta">
                  Created {timeAgo(key.createdAt)}
                  {key.current && <span className="key-badge">This browser</span>}
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  disabled={busy || key.current}
                  title={key.current ? "You can't revoke the key this browser uses" : undefined}
                  onClick={() => revoke(key)}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}

        {keys && keys.length > 0 && access && (
          <label className="field key-access">
            <span>People without a key</span>
            <select
              className="select"
              value={access}
              disabled={busy}
              onChange={(e) => changeAccess(e.target.value as PublicAccess)}
            >
              <option value="none">Can't open the project</option>
              <option value="read">Can view, but not edit</option>
            </select>
          </label>
        )}

        {error && <p className="key-error">{error}</p>}

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Done
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !keys} onClick={create}>
            <Plus size={14} /> {keys?.length ? "Create key" : "Protect with a key"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
