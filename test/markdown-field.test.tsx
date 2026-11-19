import { afterAll, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Editor } from "@tiptap/core";

// The editor component, mounted in a DOM under StrictMode, as the app does.
let React: typeof import("react");
let act: typeof import("react").act;
let createRoot: typeof import("react-dom/client").createRoot;
let MarkdownEditor: typeof import("../src/client/components/MarkdownEditor").MarkdownEditor;

beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  React = await import("react");
  act = React.act;
  ({ createRoot } = await import("react-dom/client"));
  ({ MarkdownEditor } = await import("../src/client/components/MarkdownEditor"));
});
afterAll(() => GlobalRegistrator.unregister());

function mount(value: string, maxLength?: number) {
  const commits: string[] = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (v: string) =>
    act(() =>
      root.render(
        <React.StrictMode>
          <MarkdownEditor
            value={v}
            onCommit={(c) => commits.push(c)}
            placeholder="Add a description…"
            ariaLabel="Description"
            maxLength={maxLength}
          />
        </React.StrictMode>,
      ),
    );
  render(value);
  const editor = () => (container.querySelector(".ProseMirror") as unknown as { editor: Editor } | null)?.editor;
  const unmount = async () => {
    act(() => root.unmount());
    await new Promise((r) => setTimeout(r, 10));
  };
  return { commits, container, editor, render, unmount };
}

const tick = () => act(() => new Promise((r) => setTimeout(r, 10)));

test("opening and closing a card saves nothing", async () => {
  const field = mount("# Plan\n\n- [ ] one\n- [x] two\n\nSee [docs](https://example.com).");
  await tick();
  field.editor()!.commands.focus("end");
  field.editor()!.commands.blur();
  await field.unmount();
  expect(field.commits).toEqual([]);
});

test("text the editor can't keep is shown as Markdown source, and is never rewritten", async () => {
  const field = mount("Replace the <select> with a <button>.\n\n<!-- agent: last-run=3 -->");
  await tick();
  expect(field.container.querySelector(".ProseMirror")).toBeNull();
  expect(field.container.textContent).toContain("Shown as Markdown");
  await field.unmount();
  expect(field.commits).toEqual([]);
});

test("an edit is saved as Markdown", async () => {
  const field = mount("Hello");
  await tick();
  const editor = field.editor()!;
  editor.commands.focus("end");
  editor.commands.insertContent([
    { type: "text", text: " " },
    { type: "text", text: "world", marks: [{ type: "bold" }] },
    { type: "text", text: " <b> *" },
  ]);
  editor.commands.blur();
  await tick();
  expect(field.commits).toEqual([String.raw`Hello **world** \<b> \*`]);
  await field.unmount();
});

test("Undo can't step back past a remote change", async () => {
  const field = mount("original");
  await tick();
  field.render("teammate's rewrite");
  await tick();
  const editor = field.editor()!;
  expect(editor.getText()).toBe("teammate's rewrite");
  editor.commands.focus();
  editor.commands.undo();
  editor.commands.blur();
  await tick();
  expect(editor.getText()).toBe("teammate's rewrite");
  expect(field.commits).toEqual([]);
  await field.unmount();
});

test("a remote change waits while the field has focus", async () => {
  const field = mount("mine");
  await tick();
  const editor = field.editor()!;
  editor.commands.focus();
  await tick(); // TipTap focuses on the next animation frame.
  expect(editor.isFocused).toBe(true);
  field.render("theirs");
  await tick();
  expect(editor.getText()).toBe("mine");
  editor.commands.blur();
  await tick();
  expect(editor.getText()).toBe("theirs");
  expect(field.commits).toEqual([]);
  await field.unmount();
});

test("text too long to save is kept on screen, not saved cut short", async () => {
  const field = mount("short", 20);
  await tick();
  const editor = field.editor()!;
  editor.commands.focus("end");
  editor.commands.insertContent(" and then a great deal more");
  editor.commands.blur();
  await tick();
  expect(field.commits).toEqual([]);
  expect(field.container.querySelector("[role=alert]")?.textContent).toContain("Not saved");
  await field.unmount();
});
