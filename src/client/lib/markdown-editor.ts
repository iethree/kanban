// The extensions behind the inline Markdown editor (card descriptions and documents).
// Descriptions are stored as Markdown, so the editor parses Markdown in and writes Markdown
// out. Read it back in the CLI and it should look like what a person would have typed.
import { Extension, type AnyExtension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import HardBreak from "@tiptap/extension-hard-break";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { Marked, type marked } from "marked";


export function markdownExtensions({ placeholder = "", limit }: { placeholder?: string; limit?: number } = {}) {
  const extensions: AnyExtension[] = [
    StarterKit.configure({
      hardBreak: false,
      // Markdown has no underline, so Cmd+U would make text that can't be saved.
      underline: false,
      link: {
        openOnClick: true,
        autolink: true,
        defaultProtocol: "https",
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
      },
    }),
    // With `breaks` on, a plain newline is a line break: no trailing spaces to trip over.
    HardBreak.extend({ renderMarkdown: () => "\n" }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit,
    Image,
    // Its own parser: the editor adds tokenizers that the read-only renderer must not get.
    // The options match that renderer: GitHub-flavoured, and a single newline is a line break.
    Markdown.configure({ marked: new Marked({ gfm: true, breaks: true }) as unknown as typeof marked }),
    MarkdownText,
    MarkdownPaste,
  ];
  if (placeholder) extensions.push(Placeholder.configure({ placeholder }));
  if (limit) extensions.push(CharacterCount.configure({ limit }));
  return extensions;
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

/** Pasting plain text (from a terminal, an editor or an agent) parses it as Markdown. */
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
            if (!data || !editor.markdown) return false;
            if (data.types.includes("text/html")) return false;
            const text = data.getData("text/plain");
            if (!text || editor.isActive("codeBlock")) return false;
            return editor.commands.insertContent(editor.markdown.parse(text));
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
 * of blank lines, and trailing whitespace. Fenced code blocks are left exactly as they are.
 */
export function tidyMarkdown(md: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of md.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
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
