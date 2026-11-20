import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { editorMarkdown, editsSafely, markdownExtensions, resetHistory, sameContent } from "../lib/markdown-editor";
import { useReadOnly } from "../lib/readonly";
import { MarkdownSourceField, type MarkdownFieldProps } from "./Markdown";

const SOURCE_NOTE = "Shown as Markdown: this text has formatting the editor can't keep.";

/**
 * Markdown edited in place: it is formatted as you type (`# ` makes a heading, `**bold**` goes
 * bold, `- [ ] ` starts a checklist) and looks the same whether or not it has focus.
 *
 * Every edit saves the whole text as the editor writes it, so the editor is only used for text
 * it can write back without changing (see `editsSafely`). Anything else is edited as Markdown
 * source. Edits are committed after a short pause and on blur. Remote changes replace the
 * content unless the field has focus; then they wait until it loses focus.
 */
export function MarkdownEditor(props: MarkdownFieldProps) {
  const { value, onCommit, placeholder, ariaLabel, maxLength, className = "" } = props;
  const readOnly = useReadOnly();
  const [tooLong, setTooLong] = useState<number | null>(null);
  const sync = useRef({
    /** The last value the editor was loaded with or committed. */
    loaded: value,
    /** The editor's Markdown when it last matched `loaded`. Committing only when this changes
     *  keeps a card that is only looked at, or only clicked, from being rewritten. */
    baseline: "",
    baselineOf: null as Editor | null,
    remote: value,
    commit: onCommit,
    maxLength,
    source: false,
    /** Set by a commit: on blur, check that what was saved reads back as what is on screen. */
    checkOnBlur: false,
    /** Set while the field holds an edit too long to save: nothing may replace it. */
    unsaved: false,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  }).current;
  sync.remote = value;
  sync.commit = onCommit;
  sync.maxLength = maxLength;

  const toSource = () => {
    sync.source = true;
    setSource(true);
  };

  /** Commits the editor's Markdown if it changed. Returns whether it committed. */
  const flush = (editor: Editor): boolean => {
    clearTimeout(sync.timer);
    if (editor.isDestroyed || sync.source) return false;
    const md = editorMarkdown(editor);
    // The server would cut it short. Keep the edit on screen, unsaved, and say so.
    sync.unsaved = md !== sync.baseline && !!sync.maxLength && md.length > sync.maxLength;
    setTooLong(sync.unsaved ? md.length : null);
    if (md === sync.baseline || sync.unsaved) return false;
    sync.baseline = sync.loaded = md;
    sync.commit(md);
    sync.checkOnBlur = true;
    return true;
  };

  const load = (editor: Editor, md: string) => {
    editor.commands.setContent(md, { contentType: "markdown", emitUpdate: false });
    resetHistory(editor);
    sync.unsaved = false;
    setTooLong(null);
    sync.loaded = md;
    sync.baseline = editorMarkdown(editor);
    sync.baselineOf = editor;
    if (!editsSafely(md, sync.baseline)) toSource();
  };

  const extensions = useMemo(() => markdownExtensions({ placeholder }), [placeholder]);
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
      onUpdate: ({ editor }) => {
        clearTimeout(sync.timer);
        sync.timer = setTimeout(() => flush(editor), 500);
      },
      onBlur: ({ editor }) => {
        const committed = flush(editor);
        if (sync.unsaved) return;
        // Checked here rather than on every save: it parses the whole text again.
        const misread = sync.checkOnBlur && !sameContent(editor, sync.loaded);
        sync.checkOnBlur = false;
        // Show what was really saved: this commit if there was one, else the latest remote
        // value, which includes any change that arrived while the field had focus.
        if (misread || (!committed && sync.remote !== sync.loaded)) load(editor, committed ? sync.loaded : sync.remote);
      },
    },
    [extensions],
  );

  // The baseline must be set before anything can flush, including an unmount right after mount
  // (React StrictMode does that), so it is taken here rather than in an effect or onCreate.
  if (sync.baselineOf !== editor) {
    sync.baseline = editorMarkdown(editor);
    sync.baselineOf = editor;
    if (!sync.source && !editsSafely(sync.loaded, sync.baseline)) sync.source = true;
  }
  const [source, setSource] = useState(() => sync.source);

  useEffect(() => {
    if (!sync.source && !sync.unsaved && value !== sync.loaded && !editor.isFocused) load(editor, value);
  }, [value, editor]);

  useEffect(() => {
    editor.setEditable(!readOnly, false);
    // An edit that was in progress when editing was turned off can't be saved: show the real text.
    if (readOnly && !sync.source && (sync.remote !== sync.loaded || editorMarkdown(editor) !== sync.baseline)) {
      clearTimeout(sync.timer);
      load(editor, sync.remote);
    }
  }, [readOnly, editor]);

  // Save anything outstanding on unmount (e.g. closing a dialog mid-edit).
  useEffect(() => () => void flush(editor), [editor]);

  if (readOnly && !value) return null;
  if (source) return <MarkdownSourceField {...props} note={SOURCE_NOTE} />;

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
      {tooLong !== null && maxLength && (
        <p className="md-source-note is-error" role="alert">
          Not saved: {tooLong.toLocaleString()} characters of Markdown, and the limit is {maxLength.toLocaleString()}.
          Shorten it to save.
        </p>
      )}
    </div>
  );
}

