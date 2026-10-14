import { UUID_RE } from "../shared/validate";
import { rootLlmsTxt } from "./llms";

export { ProjectRoom } from "./project-room";

const ROUTE = /^\/api\/p\/([^/]+)(?:\/(ws|export|import|ops|llms\.txt))?\/?$/;
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
      if (!projectId || !UUID_RE.test(projectId)) {
        return Response.json({ error: "Invalid project id (expected a UUID)" }, { status: 400 });
      }
      if (action === "ws" && request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      const expected = POST_ONLY.has(action) ? "POST" : "GET";
      if (request.method !== expected && !(expected === "GET" && request.method === "HEAD")) {
        return Response.json({ error: `Use ${expected}` }, { status: 405, headers: { Allow: expected } });
      }
      const id = projectId.toLowerCase();
      const stub = env.PROJECTS.get(env.PROJECTS.idFromName(id));
      // Normalise the path so the Durable Object always sees /api/p/<lowercase id>/<action>.
      return stub.fetch(new Request(new URL(`/api/p/${id}/${action}`, url.origin), request));
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
