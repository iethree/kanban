import { describe, expect, test } from "bun:test";
import { parseProjectPath } from "../src/shared/urls";
import { agentLinks, prefersMarkdown, rewriteHomePage, rewriteProjectPage } from "../src/worker/pages";

const ID = "3c5f5d83-d805-4e41-bba5-7a69e0ea588b";
const SHORT = "1pv7XjjQP9gM4BRBqypgrb";
const ORIGIN = "https://kanban.example";
const SHELL = `<!doctype html><html><head><title>Kanban</title><link rel="alternate" type="text/markdown" href="/llms.txt" /></head><body><div id="root"><section>generic</section></div></body></html>`;

const req = (accept?: string) => new Request(ORIGIN, { headers: accept ? { Accept: accept } : {} });

describe("prefersMarkdown", () => {
  test("browsers get HTML", () => {
    expect(prefersMarkdown(req("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"))).toBe(false);
    expect(prefersMarkdown(req())).toBe(false);
    expect(prefersMarkdown(req("*/*"))).toBe(false);
  });
  test("markdown when asked for", () => {
    expect(prefersMarkdown(req("text/markdown"))).toBe(true);
    expect(prefersMarkdown(req("text/markdown, text/html;q=0.5"))).toBe(true);
    expect(prefersMarkdown(req("text/html, text/markdown;q=0.5"))).toBe(false);
  });
});

describe("rewriteProjectPage", () => {
  const render = async (path: string, card: string | null = null) => {
    const links = agentLinks(ORIGIN, parseProjectPath(path)!, card);
    const res = rewriteProjectPage(new Response(SHELL, { headers: { "Content-Type": "text/html" } }), links);
    return { html: await res.text(), headers: res.headers };
  };

  test("board page points at the project's llms.txt and JSON", async () => {
    const { html, headers } = await render(`/p/my-board/${ID}`);
    expect(html).toContain(`href="${ORIGIN}/api/p/${SHORT}/llms.txt"`);
    expect(html).toContain(`type="application/json" href="${ORIGIN}/api/p/${SHORT}"`);
    expect(html).not.toContain('href="/llms.txt"');
    expect(html).not.toContain("generic");
    expect(html).toContain("you don't need a browser");
    expect(headers.get("Link")).toContain(`/api/p/${SHORT}/llms.txt`);
  });

  test("leads with the CLI, using this project's link", async () => {
    const { html } = await render(`/p/my-board/${ID}`);
    expect(html).toContain(`curl -fsSL ${ORIGIN}/install | sh`);
    expect(html).toContain(`kban init ${ORIGIN}/p/${SHORT}`);
    expect(html.indexOf("kban CLI")).toBeLessThan(html.indexOf("Over HTTP"));
  });

  test("an open card or document is pointed out with both CLI and HTTP routes", async () => {
    const card = await render(`/p/my-board/${ID}`, "abc123def4567890");
    expect(card.html).toContain("kban show abc123def4567890");
    const doc = await render(`/p/my-board/${ID}/docs/abc123`);
    expect(doc.html).toContain("kban doc abc123");
  });

  test("document page also links the document's markdown", async () => {
    const { html } = await render(`/p/my-board/${ID}/docs/abc123`);
    expect(html).toContain(`${ORIGIN}/api/p/${SHORT}/documents/abc123`);
  });

  test("ids from the URL are validated, never echoed raw", async () => {
    const { html } = await render(`/p/x/${ID}/docs/%3Cscript%3E`, "<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("/documents/");
  });
});

test("home page hint includes this site's install command", async () => {
  const res = rewriteHomePage(new Response(SHELL, { headers: { "Content-Type": "text/html" } }), ORIGIN);
  const html = await res.text();
  expect(html).toContain(`curl -fsSL ${ORIGIN}/install | sh`);
  expect(html).toContain('kban new "Project title"');
  expect(html).toContain(`href="${ORIGIN}/llms.txt"`);
  expect(html).not.toContain("generic");
});
