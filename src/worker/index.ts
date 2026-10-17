import { parseProjectPath } from "../shared/urls";
import { toProjectUuid } from "../shared/ids";
import { installScript, serveCli } from "./cli";
import { rootLlmsTxt } from "./llms";
import { agentLinks, prefersMarkdown, rewriteHomePage, rewriteProjectPage } from "./pages";

export { ProjectRoom } from "./project-room";

const ROUTE = /^\/api\/p\/([^/]+)(?:\/(ws|export|import|ops|activity|llms\.txt|documents\/[A-Za-z0-9_-]{1,64}))?\/?$/;
const POST_ONLY = new Set(["import", "ops"]);

/**
 * Project links are the only key to a project, so pages and API responses for
 * one must stay out of search results, and nothing should hand the URL to other
 * sites in a Referer header.
 */
const ROBOTS_TXT = `# Project URLs are private links: whoever has one can edit the project.
# Crawlers have no business with the API, which serves whole boards.
# Project pages (/p/...) are left crawlable on purpose: they answer with
# "X-Robots-Tag: noindex", and a crawler blocked here would never see that
# and could still list a bare URL it found linked somewhere else.
User-agent: *
Disallow: /api/
`;

function withPrivacyHeaders(res: Response, pathname: string): Response {
  // WebSocket upgrades can't be rebuilt, and carry nothing to index anyway.
  if (res.status === 101) return res;
  const headers = new Headers(res.headers);
  headers.set("Referrer-Policy", "same-origin");
  if (pathname.startsWith("/p/") || pathname.startsWith("/api/")) headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request, env): Promise<Response> {
    const res = await route(request, env);
    return withPrivacyHeaders(res, new URL(request.url).pathname);
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/robots.txt") {
    return new Response(ROBOTS_TXT, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  if (url.pathname === "/install") return installScript(url.origin);
  if (url.pathname === "/kanban.js") return serveCli(env.ASSETS, url.origin);

  if (url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
    // Agents asking for Markdown get the instructions directly; browsers get the app with a hint.
    if (prefersMarkdown(request)) return markdown(rootLlmsTxt(url.origin));
    return rewriteHomePage(await env.ASSETS.fetch(request), url.origin);
  }

  if (url.pathname === "/llms.txt") {
    return markdown(rootLlmsTxt(url.origin));
  }

  const match = url.pathname.match(ROUTE);
  if (match) {
    const [, projectId, action = ""] = match;
    const id = projectId ? toProjectUuid(projectId) : null;
    if (!id) {
      return Response.json({ error: "Invalid project id (expected a 22-character id or a UUID)" }, { status: 400 });
    }
    if (action === "ws" && request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const expected = POST_ONLY.has(action) ? "POST" : "GET";
    if (request.method !== expected && !(expected === "GET" && request.method === "HEAD")) {
      return Response.json({ error: `Use ${expected}` }, { status: 405, headers: { Allow: expected } });
    }
    const stub = env.PROJECTS.get(env.PROJECTS.idFromName(id));
    // Normalise the path so the Durable Object always sees /api/p/<uuid>/<action>.
    return stub.fetch(new Request(new URL(`/api/p/${id}/${action}${url.search}`, url.origin), request));
  }

  if (url.pathname.startsWith("/api/")) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Project pages are a client-side app, so tell agents and scripts where the
  // content lives: Markdown on request, otherwise hints injected into the HTML.
  const route = parseProjectPath(url.pathname);
  if (route && (request.method === "GET" || request.method === "HEAD")) {
    const links = agentLinks(url.origin, route, url.searchParams.get("card"));
    if (prefersMarkdown(request)) {
      const stub = env.PROJECTS.get(env.PROJECTS.idFromName(route.id));
      const target = links.document ?? links.llms;
      const res = await stub.fetch(new Request(new URL(new URL(target).pathname, url.origin), { headers: request.headers }));
      const headers = new Headers(res.headers);
      headers.set("Vary", "Accept");
      headers.set("Content-Location", target);
      return new Response(res.body, { status: res.status, headers });
    }
    // The SPA shell is index.html; fetch it explicitly rather than relying on fallback.
    const shell = await env.ASSETS.fetch(new Request(new URL("/", url.origin), request));
    return rewriteProjectPage(shell, links);
  }

  return env.ASSETS.fetch(request);
}

const markdown = (body: string) => new Response(body, { headers: { "Content-Type": "text/markdown; charset=utf-8", Vary: "Accept" } });
