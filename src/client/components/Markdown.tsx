import { Component, lazy, Suspense, useMemo, useRef, useState, type ReactNode } from "react";
import { useReadOnly } from "../lib/readonly";
import { renderMarkdown } from "../lib/render-markdown";
import { useRemoteDraft } from "../lib/useRemoteDraft";
import { useAutosize } from "./ui";

export { renderMarkdown };

export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return <div className={`markdown ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

export type MarkdownFieldProps = {
  value: string;
  onCommit: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  maxLength?: number;
  className?: string;
};

// The editor is most of the app's code, so it loads after the board instead of before it.
const loadEditor = () => import("./MarkdownEditor");
const MarkdownEditor = lazy(() => loadEditor().then((m) => ({ default: m.MarkdownEditor })));
if (typeof window !== "undefined") (window.requestIdleCallback ?? setTimeout)(() => void loadEditor());

/**
 * Markdown edited in place, formatted as you type. Until the editor has loaded, the text is
 * shown rendered, laid out the same way, so nothing moves when the editor takes over. If the
 * editor can't load, the field edits the Markdown source instead.
 */
export function MarkdownField(props: MarkdownFieldProps) {
  const readOnly = useReadOnly();
  if (readOnly && !props.value) return null;
  const fallback = (
    <div className={`md-field ${props.className ?? ""}${readOnly ? " is-static" : ""}`}>
      <div>
        {props.value ? (
          <Markdown source={props.value} className="md-content" />
        ) : (
          <div className="markdown md-content">
            <p className="is-editor-empty" data-placeholder={props.placeholder} />
          </div>
        )}
      </div>
    </div>
  );
  return (
    <EditorBoundary fallback={<MarkdownSourceField {...props} />}>
      <Suspense fallback={fallback}>
        <MarkdownEditor {...props} />
      </Suspense>
    </EditorBoundary>
  );
}

class EditorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.error("The Markdown editor failed; editing the Markdown source instead.", error);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Rendered Markdown that turns into a plain textarea of its source when clicked, and back when
 * it loses focus. Used for text the inline editor can't edit without changing it, and if the
 * editor fails to load. Edits are committed while typing (debounced) and on blur.
 */
export function MarkdownSourceField({
  value,
  onCommit,
  placeholder,
  ariaLabel,
  maxLength,
  className = "",
  note,
}: MarkdownFieldProps & { note?: string }) {
  const [editing, setEditing] = useState(false);
  const draft = useRemoteDraft(value, onCommit);
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutosize(ref, editing ? draft.value : "");
  const readOnly = useReadOnly();

  if (readOnly) {
    return value ? (
      <div className={`md-field md-source is-static ${className}`}>
        <Markdown source={value} />
      </div>
    ) : null;
  }

  const noteLine = note ? <p className="md-source-note">{note}</p> : null;

  if (!editing) {
    return (
      <div className={`md-source-wrap ${className}`}>
        <div
          className={`md-field md-source${value ? "" : " is-empty"}`}
          tabIndex={0}
          role="group"
          aria-label={`${ariaLabel}. Press Enter to edit.`}
          onClick={(e) => {
            // Let links and task-list checkboxes behave normally; don't steal text selections.
            if ((e.target as HTMLElement).closest("a, input")) return;
            if (window.getSelection()?.toString()) return;
            setEditing(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target === e.currentTarget) {
              e.preventDefault();
              setEditing(true);
            }
          }}
        >
          {value ? <Markdown source={value} /> : <span className="md-placeholder">{placeholder}</span>}
        </div>
        {noteLine}
      </div>
    );
  }

  return (
    <div className={`md-source-wrap ${className}`}>
      <textarea
        ref={ref}
        autoFocus
        className="md-field md-source md-editor"
        placeholder={`${placeholder} Markdown is supported.`}
        aria-label={ariaLabel}
        maxLength={maxLength}
        {...draft}
        onBlur={() => {
          draft.onBlur();
          setEditing(false);
        }}
        onKeyDown={(e) => {
          // Escape leaves edit mode instead of closing the surrounding dialog.
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.blur();
          }
        }}
      />
      {noteLine}
    </div>
  );
}
