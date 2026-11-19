import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Editor as EditorType } from "@tiptap/core";

// The editor needs a DOM. Register one for this file only, and import the editor after it.
let Editor: typeof EditorType;
let lib: typeof import("../src/client/lib/markdown-editor");
beforeAll(async () => {
  GlobalRegistrator.register();
  ({ Editor } = await import("@tiptap/core"));
  lib = await import("../src/client/lib/markdown-editor");
});
afterAll(() => GlobalRegistrator.unregister());

const load = (md: string) => new Editor({ extensions: lib.markdownExtensions(), content: md, contentType: "markdown" });
const roundTrip = (md: string) => lib.editorMarkdown(load(md));

describe("escapeMarkdownText", () => {
  test("leaves ordinary text alone", () => {
    expect(lib.escapeMarkdownText("2 < 3 & 4 > 1")).toBe("2 < 3 & 4 > 1");
    expect(lib.escapeMarkdownText("snake_case_name")).toBe("snake_case_name");
    expect(lib.escapeMarkdownText(String.raw`C:\Users\me`)).toBe(String.raw`C:\Users\me`);
  });

  test("escapes what would otherwise be read as Markdown or HTML", () => {
    expect(lib.escapeMarkdownText("a*b*c")).toBe(String.raw`a\*b\*c`);
    expect(lib.escapeMarkdownText("_word_")).toBe(String.raw`\_word\_`);
    expect(lib.escapeMarkdownText("use `x` [here]")).toBe(String.raw`use \`x\` \[here\]`);
    expect(lib.escapeMarkdownText("<b>hi</b>")).toBe(String.raw`\<b>hi\</b>`);
    expect(lib.escapeMarkdownText("&amp; &#38;")).toBe(String.raw`\&amp; \&#38;`);
    expect(lib.escapeMarkdownText(String.raw`\* and trailing \\`)).toBe(String.raw`\\\* and trailing \\\\`);
  });
});

describe("tidyMarkdown", () => {
  test("drops empty-paragraph placeholders and extra blank lines", () => {
    expect(lib.tidyMarkdown("a\n\n\n\n&nbsp;\n\nb\n\n")).toBe("a\n\nb");
  });

  test("leaves fenced code blocks exactly as they are", () => {
    const md = "```\nx\n\n\n&nbsp;\n```\n\n\n~~~~\n```\n\n\n~~~~";
    expect(lib.tidyMarkdown(md)).toBe("```\nx\n\n\n&nbsp;\n```\n\n~~~~\n```\n\n\n~~~~");
  });
});

describe("the editor's Markdown", () => {
  test("round-trips the formatting people use in cards", () => {
    const md = [
      "# Heading",
      "",
      "Some **bold**, *italic*, ~~strike~~, `code` and a [link](https://example.com).",
      "A second line in the same paragraph.",
      "",
      "- one",
      "  - nested",
      "",
      "1. first",
      "2. second",
      "",
      "- [ ] todo",
      "- [x] done",
      "",
      "> quoted",
      "",
      "```ts",
      "const x = a < b && c_d;",
      "```",
      "",
      "---",
      "",
      "![alt](https://example.com/x.png)",
    ].join("\n");
    expect(roundTrip(md)).toBe(md);
  });

  test("keeps tables", () => {
    expect(roundTrip("a\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nb")).toBe(
      "a\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\nb",
    );
  });

  test("writes text as typed, not as HTML entities", () => {
    expect(roundTrip("2 < 3 & snake_case")).toBe("2 < 3 & snake_case");
    expect(roundTrip(String.raw`\<b> is literal`)).toBe(String.raw`\<b> is literal`);
  });

  test("is unchanged by moving the cursor, so viewing a card never rewrites it", () => {
    const editor = load("```\ncode\n```");
    const before = lib.editorMarkdown(editor);
    editor.commands.focus("end");
    editor.commands.setTextSelection(1);
    expect(lib.editorMarkdown(editor)).toBe(before);
  });

  test("an empty editor is an empty string", () => {
    expect(roundTrip("")).toBe("");
  });

  test("literal Markdown characters are escaped so they read back as typed", () => {
    const editor = load("");
    editor.commands.focus();
    editor.commands.insertContent("plain text with <tags> and **stars**");
    expect(lib.editorMarkdown(editor)).toBe(String.raw`plain text with \<tags> and \*\*stars\*\*`);
  });
});
