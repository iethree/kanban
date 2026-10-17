import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { LIMITS, type Card } from "../../shared/types";
import { assigneeSuggestions } from "../lib/assignees";

/**
 * The assignee field: free text with a dropdown of everyone already assigned
 * to a card in the project. Commits when a suggestion is picked, on Enter, or
 * when the field loses focus — not on every keystroke, so half-typed names
 * never get saved.
 */
export function AssigneeInput({
  id,
  value,
  cards,
  onCommit,
}: {
  id: string;
  value: string;
  cards: Record<string, Card>;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const focused = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Follow remote changes unless the user is typing.
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  // Save an unfinished edit if the dialog closes while the field has focus.
  const latest = useRef({ draft, value, onCommit });
  latest.current = { draft, value, onCommit };
  useEffect(
    () => () => {
      const { draft, value, onCommit } = latest.current;
      if (focused.current && draft.trim() !== value) onCommit(draft.trim());
    },
    [],
  );

  // While the field still shows the saved name, list everyone; once the user types, filter.
  const query = draft === value ? "" : draft;
  const options = useMemo(() => assigneeSuggestions(cards, query), [cards, query]);
  const showList = open && options.length > 0;

  const commit = (next: string) => {
    const trimmed = next.trim();
    setDraft(trimmed);
    if (trimmed !== value) onCommit(trimmed);
  };

  const choose = (name: string) => {
    commit(name);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div className="combobox">
      <input
        ref={inputRef}
        id={id}
        className="text-input"
        placeholder="Unassigned"
        maxLength={LIMITS.assignee}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => {
          focused.current = true;
          setOpen(true);
        }}
        onBlur={() => {
          focused.current = false;
          setOpen(false);
          setActive(-1);
          commit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!options.length) return;
            setOpen(true);
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive((i) => (i + step + options.length + (i < 0 && step < 0 ? 1 : 0)) % options.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (showList && active >= 0) choose(options[active]!.name);
            else e.currentTarget.blur();
          } else if (e.key === "Escape" && showList) {
            // Close the list first; a second Escape closes the dialog.
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            setActive(-1);
          }
        }}
      />
      {draft && !showList && (
        <button
          type="button"
          className="combobox-clear"
          aria-label="Unassign"
          title="Unassign"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => choose("")}
        >
          <X size={13} />
        </button>
      )}
      {showList && (
        <ul id={listId} role="listbox" className="combobox-list" aria-label="People in this project">
          {options.map((option, i) => (
            <li
              key={option.name}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`combobox-option${i === active ? " is-active" : ""}${option.name === value ? " is-current" : ""}`}
              // Keep focus in the input so blur doesn't commit the half-typed text first.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(option.name)}
            >
              <span className="avatar" aria-hidden>
                {option.name[0]!.toUpperCase()}
              </span>
              <span className="combobox-name">
                <Highlight text={option.name} query={query} />
              </span>
              <span className="combobox-meta">
                {option.count} card{option.count === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Bolds the part of `text` that matches the query. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}
