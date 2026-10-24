import { KEY_HEADER, KEY_RE, type KeyInfo } from "../../shared/keys";

/** This browser's key for each protected project, by project id. */
const STORAGE = "kanban.keys.v1";

function readAll(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(keys: Record<string, string>) {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(keys));
  } catch {
    // Storage disabled: the key lasts until the page is closed, through the socket that's open.
  }
}

export const getKey = (projectId: string): string | null => readAll()[projectId] ?? null;

export function setKey(projectId: string, key: string) {
  writeAll({ ...readAll(), [projectId]: key });
}

/**
 * Links can carry a key after `#key=`. The fragment never reaches the server; save the key and
 * take it out of the address bar so it isn't copied along with the link by accident.
 */
export function takeKeyFromHash(projectId: string): boolean {
  const key = new URLSearchParams(location.hash.slice(1)).get("key");
  if (!key) return false;
  history.replaceState(history.state, "", location.pathname + location.search);
  if (!KEY_RE.test(key)) return false;
  setKey(projectId, key);
  return true;
}

/** `fetch` for a project's API, sending this browser's key if it has one. */
export function apiFetch(projectId: string, path: string, init: RequestInit = {}): Promise<Response> {
  const key = getKey(projectId);
  const headers = new Headers(init.headers);
  if (key) headers.set(KEY_HEADER, key);
  return fetch(`/api/p/${projectId}${path}`, { ...init, headers });
}

/** Whether this browser's key (or lack of one) is what keeps it out of the project; null if not. */
export async function keyProblemOf(projectId: string): Promise<"required" | "invalid" | null> {
  try {
    const res = await apiFetch(projectId, "/keys");
    if (res.status !== 401) return null;
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    return body?.code === "key_invalid" ? "invalid" : "required";
  } catch {
    return null;
  }
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const listKeys = (projectId: string) =>
  apiFetch(projectId, "/keys").then((res) => json<{ keys: KeyInfo[] }>(res)).then((b) => b.keys);

export const createKey = (projectId: string) =>
  apiFetch(projectId, "/keys", { method: "POST" }).then((res) => json<Omit<KeyInfo, "current"> & { key: string }>(res));

export const revokeKey = (projectId: string, id: string) =>
  apiFetch(projectId, `/keys/${id}`, { method: "DELETE" }).then((res) => json<{ ok: true }>(res));
