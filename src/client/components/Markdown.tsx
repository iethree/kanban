import { useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useReadOnly } from "../lib/readonly";
import { useRemoteDraft } from "../lib/useRemoteDraft";
import { useAutosize } from "./ui";

marked.setOptions({ gfm: true, breaks: true });

// Anyone with a project link can edit it, so rendered HTML must be sanitized.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(marked.parse(source, { async: false }));
}

export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return <div className={`markdown ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Rendered Markdown that turns into a plain textarea when clicked, and back
 * when it loses focus. Edits are committed while typing (debounced) and on blur.
 */
export function MarkdownField({
  value,
  onCommit,
  placeholder,
  ariaLabel,
  maxLength,
  className = "",
  startEditing = false,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  maxLength?: number;
  className?: string;
  startEditing?: boolean;
}) {
  const [editing, setEditing] = useState(startEditing);
  const draft = useRemoteDraft(value, onCommit);
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutosize(ref, editing ? draft.value : "");
  const readOnly = useReadOnly();

  if (readOnly) {
    return value ? (
      <div className={`md-field is-static ${className}`}>
        <Markdown source={value} />
      </div>
    ) : null;
  }

  if (!editing) {
    return (
      <div
        className={`md-field ${className}${value ? "" : " is-empty"}`}
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
    );
  }

  return (
    <textarea
      ref={ref}
      autoFocus
      className={`md-field md-editor ${className}`}
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
  );
}
