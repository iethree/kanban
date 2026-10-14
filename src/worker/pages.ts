import { toShortId } from "../shared/ids";
import type { ProjectRoute } from "../shared/urls";

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Where an agent can fetch the content of a given page without a browser. */
export function agentLinks(origin: string, route: ProjectRoute, cardId: string | null) {
  const api = `${origin}/api/p/${toShortId(route.id)}`;
  const documentId = route.view.kind === "docs" && route.view.documentId && SAFE_ID.test(route.view.documentId)
    ? route.view.documentId
    : undefined;
  return {
    api,
    llms: `${api}/llms.txt`,
    document: documentId ? `${api}/documents/${documentId}` : undefined,
    documentId,
    cardId: cardId && SAFE_ID.test(cardId) ? cardId : undefined,
  };
}

/**
 * Plain HTML placed inside #root. Agents and scripts that fetch the page without
 * running JavaScript see it; in a browser React replaces it on first render.
 * It is visually hidden (not `hidden`/`display:none`) so text extractors keep it.
 */
function agentHintHtml(links: ReturnType<typeof agentLinks>): string {
  const code = (s: string) => `<code>${escapeHtml(s)}</code>`;
  const items = [
    `Instructions, a Markdown snapshot of the board, and the edit API: <code>GET</code> ${code(links.llms)}`,
    `The whole project (columns, cards, documents) as JSON: <code>GET</code> ${code(links.api)}`,
    `Make changes: <code>POST</code> ${code(`${links.api}/ops`)} with <code>{"ops": [...]}</code> (see llms.txt for the op reference)`,
  ];
  if (links.document) {
    items.unshift(`This document (${code(links.documentId!)}) as raw Markdown: <code>GET</code> ${code(links.document)}`);
  }
  if (links.cardId) {
    items.unshift(`This page has card ${code(links.cardId)} open. Find it by id in the JSON from ${code(links.api)}.`);
  }
  return `<section id="agent-hint" style="position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0">
<h1>Kanban project</h1>
<p>This page is a JavaScript app. If you are an AI agent or a script, you don't need a browser. Read and update this project over HTTP instead:</p>
<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>
<p>Only the id at the end of the URL identifies the project; the name before it is cosmetic. No authentication is needed.</p>
</section>`;
}

/** Injects discovery links and the agent hint into the app's HTML shell. */
export function rewriteProjectPage(response: Response, links: ReturnType<typeof agentLinks>): Response {
  const alternate = (type: string, href: string, title: string) =>
    `<link rel="alternate" type="${type}" href="${escapeHtml(href)}" title="${escapeHtml(title)}" />`;

  const rewritten = new HTMLRewriter()
    // Replace the generic /llms.txt link from index.html with this project's.
    .on('link[rel="alternate"]', {
      element(el) {
        el.remove();
      },
    })
    .on("head", {
      element(el) {
        el.append(alternate("text/markdown", links.llms, "Instructions and board snapshot for AI agents"), { html: true });
        el.append(alternate("application/json", links.api, "Project data (JSON)"), { html: true });
        if (links.document) el.append(alternate("text/markdown", links.document, "This document (Markdown)"), { html: true });
      },
    })
    .on("#root", {
      element(el) {
        el.setInnerContent(agentHintHtml(links), { html: true });
      },
    })
    .transform(response);

  const headers = new Headers(rewritten.headers);
  headers.append("Link", `<${links.llms}>; rel="alternate"; type="text/markdown"`);
  headers.append("Vary", "Accept");
  return new Response(rewritten.body, { status: rewritten.status, headers });
}

/** True when the client asks for Markdown or plain text rather than HTML (e.g. `curl -H 'Accept: text/markdown'`). */
export function prefersMarkdown(request: Request): boolean {
  const accept = request.headers.get("Accept") ?? "";
  if (!accept) return false;
  const types = accept.split(",").map((part) => {
    const [type = "", ...params] = part.trim().split(";");
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return { type: type.trim().toLowerCase(), q: q ? Number(q.slice(2)) : 1 };
  });
  const score = (t: string) => types.find((x) => x.type === t)?.q ?? 0;
  const markdown = Math.max(score("text/markdown"), score("text/x-markdown"));
  return markdown > 0 && markdown >= score("text/html");
}
