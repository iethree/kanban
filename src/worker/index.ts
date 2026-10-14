import { parseProjectPath } from "../shared/urls";
import { toProjectUuid } from "../shared/ids";
import { rootLlmsTxt } from "./llms";
import { agentLinks, prefersMarkdown, rewriteProjectPage } from "./pages";

export { ProjectRoom } from "./project-room";

const ROUTE = /^\/api\/p\/([^/]+)(?:\/(ws|export|import|ops|llms\.txt|documents\/[A-Za-z0-9_-]{1,64}))?\/?$/;
const POST_ONLY = new Set(["import", "ops"]);

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/llms.txt") {
      return new Response(rootLlmsTxt(url.origin), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
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
      return stub.fetch(new Request(new URL(`/api/p/${id}/${action}`, url.origin), request));
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
  },
} satisfies ExportedHandler<Env>;
