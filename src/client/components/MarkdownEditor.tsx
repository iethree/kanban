import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { editorMarkdown, markdownExtensions } from "../lib/markdown-editor";
import { useReadOnly } from "../lib/readonly";
import type { MarkdownFieldProps } from "./Markdown";

/**
 * Markdown edited in place: it is formatted as you type (`# ` makes a heading, `**bold**` goes
 * bold, `- [ ] ` starts a checklist) and looks the same whether or not it has focus.
 * Edits are committed after a short pause and on blur. Remote changes replace the content
 * unless the field has focus; then they wait until it loses focus.
 */
export function MarkdownEditor({
  value,
  onCommit,
  placeholder,
  ariaLabel,
  maxLength,
  className = "",
}: MarkdownFieldProps) {
  const readOnly = useReadOnly();
  const sync = useRef({
    /** The last value the editor was loaded with or committed. */
    loaded: value,
    /** The editor's Markdown when it last matched `loaded`. Committing only when this changes
     *  keeps a card that is only looked at, or only clicked, from being rewritten. */
    baseline: "",
    remote: value,
    commit: onCommit,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  }).current;
  sync.remote = value;
  sync.commit = onCommit;

  const flush = (editor: Editor) => {
    clearTimeout(sync.timer);
    if (editor.isDestroyed) return;
    const md = editorMarkdown(editor);
    if (md === sync.baseline) return;
    sync.baseline = sync.loaded = md;
    sync.commit(md);
  };

  const load = (editor: Editor) => {
    editor.commands.setContent(sync.remote, { contentType: "markdown", emitUpdate: false });
    sync.loaded = sync.remote;
    sync.baseline = editorMarkdown(editor);
  };

  const extensions = useMemo(() => markdownExtensions({ placeholder, limit: maxLength }), [placeholder, maxLength]);
  const editor = useEditor(
    {
      extensions,
      content: value,
      contentType: "markdown",
      editable: !readOnly,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          class: "markdown md-content",
          "aria-label": ariaLabel,
          "aria-multiline": "true",
          role: "textbox",
        },
        handleKeyDown: (view, event) => {
          // Escape leaves the field instead of closing the surrounding dialog.
          if (event.key !== "Escape") return false;
          event.stopPropagation();
          (view.dom as HTMLElement).blur();
          return true;
        },
      },
      onCreate: ({ editor }) => {
        sync.baseline = editorMarkdown(editor);
      },
      onUpdate: ({ editor }) => {
        clearTimeout(sync.timer);
        sync.timer = setTimeout(() => flush(editor), 500);
      },
      onBlur: ({ editor }) => {
        flush(editor);
        if (sync.remote !== sync.loaded) load(editor);
      },
    },
    [extensions],
  );

  useEffect(() => {
    if (value !== sync.loaded && !editor.isFocused) load(editor);
  }, [value, editor]);

  useEffect(() => {
    editor.setEditable(!readOnly, false);
  }, [readOnly, editor]);

  // Save anything outstanding on unmount (e.g. closing a dialog mid-edit).
  useEffect(() => () => flush(editor), [editor]);

  if (readOnly && !value) return null;

  return (
    <div
      className={`md-field ${className}${readOnly ? " is-static" : ""}`}
      onMouseDown={(e) => {
        // A click in the padding below the text puts the cursor at the end, as in a textarea.
        if (readOnly || e.target !== e.currentTarget) return;
        e.preventDefault();
        editor.commands.focus("end");
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
