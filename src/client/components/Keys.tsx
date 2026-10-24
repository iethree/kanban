import { useEffect, useState } from "react";
import { Copy, KeyRound, Plus } from "lucide-react";
import { KEY_RE, type KeyInfo } from "../../shared/keys";
import { createKey, getKey, listKeys, revokeKey, setKey } from "../lib/keys";
import { Modal, timeAgo } from "./ui";

/** Shown instead of the board when the project needs a key this browser doesn't have. */
export function KeyPrompt({ projectId, problem, onKey }: { projectId: string; problem: "required" | "invalid" | null; onKey: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="key-prompt">
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
            <KeyRound size={18} /> This project needs a key
          </h2>
          <p>
            {problem === "invalid"
              ? "That key doesn't work for this project. It may have been revoked. Enter another key."
              : "The project's owners protected it with keys. Enter a key to open it. Anyone who can open the project can create one for you, from Keys… in the project menu."}
          </p>
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
          <button type="submit" className="btn btn-primary" disabled={!value.trim()}>
            Open project
          </button>
        </div>
      </form>
    </div>
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

  const refresh = () =>
    listKeys(projectId)
      .then(setKeys)
      .catch((err: Error) => setError(err.message));

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
              ? "People need the link and one of these keys to open this project. Revoke a key to take access away from everyone who uses it."
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
