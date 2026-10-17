import { toProjectUuid, toShortId } from "./ids";

/** A readable URL segment for a project title. Purely cosmetic: routing only uses the UUID. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "project";
}

/** Canonical page path for a project: `/p/<slug>/<short id>[/suffix]`. Accepts either id form. */
export function projectPath(id: string, title: string, suffix = ""): string {
  return `/p/${slugify(title)}/${toShortId(id)}${suffix}`;
}

/** `id` is always the canonical UUID, whichever form appeared in the URL. */
export type ProjectRoute = {
  id: string;
  view: { kind: "board" } | { kind: "list" } | { kind: "activity" } | { kind: "docs"; documentId?: string };
};

/**
 * Parses `/p/[<anything>/]<id>[/list | /activity | /docs[/<documentId>]]`, where the id is the short
 * base62 form or a UUID. The segment before the id is ignored, so renamed
 * projects and old `/p/<uuid>` links keep working.
 */
export function parseProjectPath(pathname: string): ProjectRoute | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "p") return null;
  // Prefer `/p/<name>/<id>` over `/p/<id>/...`, in case a name happens to look like an id.
  const idIndex = [2, 1].find((i) => parts[i] !== undefined && toProjectUuid(parts[i]!) !== null);
  if (idIndex === undefined) return null;
  const [section, documentId, ...extra] = parts.slice(idIndex + 1);
  const id = toProjectUuid(parts[idIndex]!)!;
  if (section === undefined) return { id, view: { kind: "board" } };
  if ((section === "list" || section === "activity") && documentId === undefined) {
    return { id, view: { kind: section } };
  }
  if (section === "docs" && extra.length === 0) return { id, view: { kind: "docs", documentId } };
  return null;
}
