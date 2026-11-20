// The extensions behind the inline Markdown editor (card descriptions and documents).
// Descriptions are stored as Markdown, so the editor parses Markdown in and writes Markdown
// out. Read it back in the CLI and it should look like what a person would have typed.
import { Extension, type AnyExtension, type Editor, type JSONContent } from "@tiptap/core";
import { EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import CodeBlock from "@tiptap/extension-code-block";
import HardBreak from "@tiptap/extension-hard-break";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Paragraph from "@tiptap/extension-paragraph";
import { TableCell, TableHeader, TableKit } from "@tiptap/extension-table";
import Heading from "@tiptap/extension-heading";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { Marked, marked } from "marked";
import { renderMarkdown } from "./render-markdown";

type Attrs = Record<string, unknown> | undefined;
const attr = (attrs: Attrs, key: string) => (typeof attrs?.[key] === "string" ? (attrs[key] as string) : "");

export function markdownExtensions({ placeholder = "" }: { placeholder?: string } = {}) {
  const extensions: AnyExtension[] = [
    StarterKit.configure({
      paragraph: false,
      heading: false,
      codeBlock: false,
      hardBreak: false,
      link: false,
      // Markdown has no underline, so Cmd+U would make text that can't be saved.
      underline: false,
    }),
    Paragraph.extend({
      renderMarkdown(node, h, ctx) {
        const parent = this.parent as unknown as (n: typeof node, hh: typeof h, c: typeof ctx) => string;
        return escapeLineStarts(parent(node, h, ctx));
      },
    }),
    Heading.extend({
      renderMarkdown(node, h, ctx) {
        const parent = this.parent as unknown as (n: typeof node, hh: typeof h, c: typeof ctx) => string;
        // A run of # at the end of a heading is read as its closing sequence and dropped.
        return parent(node, h, ctx).replace(/(\s)(#+\s*)$/, "$1\\$2");
      },
    }),
    CodeBlock.extend({
      renderMarkdown(node) {
        const code = (node.content ?? []).map((n) => n.text ?? "").join("");
        return fenceCode(code, attr(node.attrs, "language"));
      },
    }),
    // With `breaks` on, a plain newline is a line break: no trailing spaces to trip over. A
    // heading or a table cell must stay on one line, so there it is written as <br>.
    HardBreak.extend({
      renderMarkdown: (_node, _h, ctx) =>
        ["heading", "tableCell", "tableHeader"].includes(String(ctx?.parentType)) ? "<br>" : "\n",
    }),
    Link.extend({
      renderMarkdown(node, h) {
        return `[${h.renderChildren(node)}](${linkTarget(attr(node.attrs, "href"), attr(node.attrs, "title"))})`;
      },
      // Typing at the end of a link continues the text after it, not the link.
      inclusive: () => false,
    }).configure({
      // A plain click edits the link text. Cmd/Ctrl+click opens it (see LinkClick).
      openOnClick: false,
      autolink: true,
      defaultProtocol: "https",
      HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    // A Markdown table cell holds one line of inline text: no code blocks or lists, which it
    // couldn't save.
    TableKit.configure({ tableCell: false, tableHeader: false }),
    TableCell.extend({ content: "paragraph" }),
    TableHeader.extend({ content: "paragraph" }),
    Image.extend({
      renderMarkdown(node) {
        const alt = attr(node.attrs, "alt").replace(/[\\[\]]/g, "\\$&");
        return `![${alt}](${linkTarget(attr(node.attrs, "src"), attr(node.attrs, "title"))})`;
      },
    }),
    // Its own parser: the editor adds tokenizers that the read-only renderer must not get.
    // The options match that renderer: GitHub-flavoured, and a single newline is a line break.
    Markdown.configure({ marked: new Marked({ gfm: true, breaks: true }) as unknown as typeof marked }),
    MarkdownText,
    MarkdownPaste,
    LinkClick,
  ];
  if (placeholder) extensions.push(Placeholder.configure({ placeholder }));
  return extensions;
}

/** A link destination, in angle brackets when it has characters that would end it early. */
function linkTarget(url: string, title: string): string {
  const dest = /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, (c) => encodeURIComponent(c))}>` : url;
  return title ? `${dest} "${title.replace(/["\\]/g, "\\$&")}"` : dest;
}

/** A fenced code block whose fence is longer than any run of backticks in the code. */
export function fenceCode(code: string, language = ""): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${code}\n${fence}`;
}

/**
 * Escapes the start of each line of a paragraph where Markdown would otherwise read it as a
 * heading, list, quote, rule or table. Leading spaces are dropped: Markdown ignores them, or
 * (four or more) turns the line into code.
 */
export function escapeLineStarts(paragraph: string): string {
  return paragraph
    .split("\n")
    .map((raw) => {
      const line = raw.replace(/^[ \t]+/, "");
      const block =
        /^#{1,6}(\s|$)/.test(line) || // heading
        /^[-+](\s|$)/.test(line) || // list item
        /^[>|]/.test(line) || // quote, table row
        /^=+\s*$/.test(line) || // underline that makes the line above a heading
        /^[-:][-:|\s]*$/.test(line); // rule, heading underline, table delimiter row
      if (block) return `\\${line}`;
      return line.replace(/^(\d{1,9})([.)])(?=\s|$)/, "$1\\$2");
    })
    .join("\n");
}

/**
 * Escapes text only where Markdown would otherwise misread it. The stock serializer turns
 * every `<` into `&lt;` and every `_` into `\_`, which is noise to anyone reading the raw text.
 */
export function escapeMarkdownText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const prev = text[i - 1] ?? "";
    const next = text[i + 1] ?? "";
    const rest = text.slice(i);
    let escape = false;
    if (c === "\\") escape = next === "" || /[!-/:-@[-`{-~]/.test(next);
    else if (c === "*" || c === "`" || c === "~" || c === "[" || c === "]") escape = true;
    // An underscore inside a word is never emphasis.
    else if (c === "_") escape = !(/[\p{L}\p{N}]/u.test(prev) && /[\p{L}\p{N}]/u.test(next));
    // Only where it could start a tag, a comment or an autolink.
    else if (c === "<") escape = /^<[A-Za-z/!?]/.test(rest);
    // Only where it could start an entity.
    else if (c === "&") escape = /^&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(rest);
    out += escape ? `\\${c}` : c;
  }
  return out;
}

type TextNode = { text?: string; marks?: { type: string }[] };
type ManagerInternals = {
  codeTypes: Set<string>;
  encodeTextForMarkdown: (text: string, node: TextNode, parent?: { type?: string }) => string;
};

/** Swaps in {@link escapeMarkdownText}. Code spans and code blocks are written literally. */
const MarkdownText = Extension.create({
  name: "markdownText",
  onBeforeCreate() {
    const manager = this.editor.markdown as unknown as ManagerInternals | undefined;
    if (!manager) return;
    manager.encodeTextForMarkdown = (text, node, parent) => {
      const inCode =
        (parent?.type != null && manager.codeTypes.has(parent.type)) ||
        (node.marks ?? []).some((m) => manager.codeTypes.has(typeof m === "string" ? m : m.type));
      return inCode ? text : escapeMarkdownText(text);
    };
  },
});

/**
 * Pasting plain text (from a terminal or an agent) parses it as Markdown, if the editor can keep
 * all of it. Otherwise it is pasted as plain text. Anything copied with HTML (a web page, a
 * document, a code editor) is pasted as that HTML.
 */
const MarkdownPaste = Extension.create({
  name: "markdownPaste",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("markdownPaste"),
        props: {
          handlePaste(_view, event) {
            const data = event.clipboardData;
            const manager = editor.markdown;
            if (!data || !manager) return false;
            if (data.types.includes("text/html")) return false;
            const text = data.getData("text/plain");
            if (!text || editor.isActive("codeBlock")) return false;
            const doc = manager.parse(text);
            if (!editsSafely(text, tidyMarkdown(manager.serialize(doc)))) return false;
            return editor.commands.insertContent(doc);
          },
        },
      }),
    ];
  },
});

/** Cmd/Ctrl+click opens a link in a new tab, without giving the new page a handle on this one. */
const LinkClick = Extension.create({
  name: "linkClick",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("linkClick"),
        props: {
          handleClick(view, _pos, event) {
            if (!view.editable || !(event.metaKey || event.ctrlKey)) return false;
            const link = (event.target as HTMLElement | null)?.closest?.("a[href]");
            if (!link || !view.dom.contains(link)) return false;
            window.open(link.getAttribute("href")!, "_blank", "noopener,noreferrer");
            return true;
          },
        },
      }),
    ];
  },
});

/** The editor's content as Markdown, tidied with {@link tidyMarkdown}. */
export function editorMarkdown(editor: Editor): string {
  return editor.isEmpty ? "" : tidyMarkdown(editor.getMarkdown());
}

/**
 * Removes the padding the serializer leaves: `&nbsp;` placeholders for empty paragraphs, runs
 * of blank lines, and trailing whitespace. Fenced code blocks, at any indent (they may be in a
 * list), are left exactly as they are.
 */
export function tidyMarkdown(md: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of md.split("\n")) {
    const marker = /^[ \t]*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length)) fence = null;
      out.push(line);
      continue;
    }
    if (marker) fence = marker;
    const blank = line.trim() === "" || line.trim() === "&nbsp;";
    if (blank && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(blank ? "" : line);
  }
  return out.join("\n").replace(/\s+$/, "");
}

/**
 * Whether the editor can take `original` and write back `serialized` without losing anything:
 * the source has no raw HTML (the editor keeps only the tags it knows, and drops comments, which
 * don't render but can matter to whoever wrote them), and both render the same.
 */
export function editsSafely(original: string, serialized: string): boolean {
  return original === serialized || (!hasHiddenContent(original) && sameRendering(original, serialized));
}

/**
 * Whether Markdown has content that doesn't show when rendered, so the rendering check can't
 * see the editor dropping it: raw HTML (comments, tags the editor doesn't know) other than the
 * <br> the editor writes itself, link reference definitions (`[//]: # (a comment)`), front
 * matter, and table rows with more cells than the header.
 */
export function hasHiddenContent(md: string): boolean {
  if (/^---[ \t]*\r?\n[\s\S]*?\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/.test(md)) return true;
  const tokens = marked.lexer(md);
  if (Object.keys(tokens.links ?? {}).length > 0) return true;
  let found = false;
  marked.walkTokens(tokens, (token) => {
    if (token.type === "html" && !/^<br\s*\/?>$/i.test(token.raw.trim())) found = true;
    if (token.type === "table") {
      const widths = token.raw
        .trim()
        .split("\n")
        .map((line) => line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).length);
      if (widths.some((w) => w > widths[0]!)) found = true;
    }
  });
  return found;
}

/**
 * Whether two Markdown texts look the same when rendered. The editor is used only for text it
 * can write back this way: anything else (raw HTML, unusual link syntax, named entities…) is
 * edited as source, so nothing is lost. Paragraph tags are ignored, so a loose list and a tight
 * one count as the same.
 */
export function sameRendering(a: string, b: string): boolean {
  return a === b || normalizeHtml(renderMarkdown(a)) === normalizeHtml(renderMarkdown(b));
}

function normalizeHtml(html: string): string {
  return html
    .replace(/\s+/g, " ")
    .replace(/> </g, "><")
    .replace(/<\/p><p>/g, "\u00b6")
    .replace(/<\/?p>/g, "")
    .trim();
}

/**
 * Whether two documents have the same content, ignoring whitespace that Markdown doesn't keep
 * and empty paragraphs. Used to check that what was saved reads back as what is on screen.
 */
export function sameContent(editor: Editor, md: string): boolean {
  if (!editor.markdown) return true;
  // Through the schema, so both sides have every attribute, defaults included.
  const saved = editor.schema.nodeFromJSON(editor.markdown.parse(md)).toJSON() as JSONContent;
  return JSON.stringify(signature(editor.getJSON())) === JSON.stringify(signature(saved));
}

function signature(node: JSONContent): unknown {
  if (node.type === "text") return null;
  const children: unknown[] = [];
  let text: { text: string; marks: string } | null = null;
  for (const child of node.content ?? []) {
    if (child.type === "text") {
      const marks = JSON.stringify(child.marks ?? []);
      if (text && text.marks === marks) text.text += child.text ?? "";
      else children.push((text = { text: child.text ?? "", marks }));
      continue;
    }
    text = null;
    if (child.type === "paragraph" && !(child.content ?? []).length) continue;
    children.push(signature(child));
  }
  for (const c of children as { text?: string }[]) if (typeof c?.text === "string") c.text = c.text.replace(/\s+/g, " ");
  const first = children[0] as { text?: string } | undefined;
  const last = children[children.length - 1] as { text?: string } | undefined;
  if (typeof first?.text === "string") first.text = first.text.trimStart();
  if (typeof last?.text === "string") last.text = last.text.trimEnd();
  return { type: node.type, attrs: node.attrs ?? {}, content: children.filter((c) => (c as { text?: string })?.text !== "") };
}

/** Starts a fresh undo history, so Undo can't step back past content loaded from elsewhere. */
export function resetHistory(editor: Editor) {
  const { doc, plugins, selection } = editor.state;
  editor.view.updateState(EditorState.create({ doc, plugins, selection }));
}
