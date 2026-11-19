import { lazy, Suspense, useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useReadOnly } from "../lib/readonly";

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
 * shown rendered, laid out the same way, so nothing moves when the editor takes over.
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
    <Suspense fallback={fallback}>
      <MarkdownEditor {...props} />
    </Suspense>
  );
}
