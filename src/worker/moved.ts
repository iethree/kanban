import { MOVED_HOSTS, ORIGIN, currentUrl } from "../shared/domains";
import { KEY_RE } from "../shared/keys";

/** Where the browser keeps its project keys (see src/client/lib/keys.ts). */
const KEY_STORAGE = "kanban.keys.v1";
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const HANDOVER_PATH = "/moved";

/** JSON that is safe inside an inline <script>. */
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
const escapeAttr = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function html(body: string, headers: Record<string, string> = {}) {
  return new Response(`<!doctype html>\n<meta charset="utf-8">\n<meta name="robots" content="noindex">\n<title>kban has moved</title>\n${body}\n`, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

/**
 * Requests to a host the app moved from. API calls, scripts and the CLI get a 308, which keeps the method and
 * body. Browsers opening a page get a page that first hands this origin's saved keys to the new one, because
 * localStorage belongs to an origin and the keys would otherwise stay behind. Returns null for other hosts, and
 * for WebSockets, so tabs opened before the move keep working.
 */
export function fromMovedHost(request: Request): Response | null {
  const url = new URL(request.url);
  if (!MOVED_HOSTS.includes(url.hostname)) return null;
  if (request.headers.get("Upgrade") === "websocket") return null;

  const target = currentUrl(url);
  const navigation = request.method === "GET" && request.headers.get("Sec-Fetch-Mode") === "navigate";
  if (!navigation) return new Response(null, { status: 308, headers: { Location: target.href } });

  // The keys go in a POST body, never in a URL, so they can't end up in history, logs or a shared link.
  return html(
    `<p>kban has moved to <a href="${escapeAttr(target.href)}">${escapeAttr(target.host)}</a>.</p>
<form method="post" action="${escapeAttr(new URL(HANDOVER_PATH, ORIGIN).href)}"><input type="hidden" name="keys"><input type="hidden" name="path"></form>
<script>
(function () {
  var target = ${scriptJson(target.href)} + location.hash;
  var keys = null;
  try { keys = localStorage.getItem(${scriptJson(KEY_STORAGE)}); } catch (e) {}
  if (!keys || keys === "{}") return location.replace(target);
  var form = document.forms[0];
  form.keys.value = keys;
  form.path.value = ${scriptJson(target.pathname + target.search)} + location.hash;
  form.submit();
})();
</script>`,
    // So the POST carries an Origin header that /moved can check; the app's usual same-origin policy would send "null".
    { "Referrer-Policy": "origin" },
  );
}

/** POST /moved: saves the keys handed over from an old host in this origin's storage, then opens the page. */
export async function receiveHandover(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 303, headers: { Location: "/" } });
  // Only the old host's own page may hand keys over; any other site could use this to plant keys.
  const origin = request.headers.get("Origin") ?? "";
  if (!MOVED_HOSTS.some((host) => origin === `https://${host}`)) {
    return Response.json({ error: "Keys can only be handed over from a host this app moved from" }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const keys: Record<string, string> = {};
  try {
    const parsed = JSON.parse(String(form?.get("keys") ?? "{}"));
    for (const [id, key] of Object.entries(parsed ?? {})) {
      if (SAFE_ID.test(id) && typeof key === "string" && KEY_RE.test(key)) keys[id] = key;
    }
  } catch {
    // Unreadable keys: open the page anyway, and people enter their key again.
  }
  const requested = String(form?.get("path") ?? "/");
  const path = /^\/(?![/\\])/.test(requested) ? requested : "/";

  return html(`<script>
(function () {
  var name = ${scriptJson(KEY_STORAGE)};
  try {
    var saved = JSON.parse(localStorage.getItem(name) || "{}") || {};
    var handed = ${scriptJson(keys)};
    // A key already saved here is newer than the old host's, so it wins.
    for (var id in handed) if (!(id in saved)) saved[id] = handed[id];
    localStorage.setItem(name, JSON.stringify(saved));
  } catch (e) {}
  location.replace(${scriptJson(path)});
})();
</script>`);
}
