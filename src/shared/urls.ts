import { UUID_RE } from "./validate";

/** A readable URL segment for a project title. Purely cosmetic: routing only uses the UUID. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "project";
}

/** Canonical page path for a project: `/p/<slug>/<uuid>[/suffix]`. */
export function projectPath(id: string, title: string, suffix = ""): string {
  return `/p/${slugify(title)}/${id}${suffix}`;
}

export type ProjectRoute = { id: string; view: { kind: "board" } | { kind: "docs"; documentId?: string } };

/**
 * Parses `/p/[<anything>/]<uuid>[/docs[/<documentId>]]`. The segment before the
 * UUID is ignored, so renamed projects and old `/p/<uuid>` links keep working.
 */
export function parseProjectPath(pathname: string): ProjectRoute | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "p") return null;
  const idIndex = parts.findIndex((part, i) => i > 0 && i <= 2 && UUID_RE.test(part));
  if (idIndex === -1) return null;
  const [section, documentId, ...extra] = parts.slice(idIndex + 1);
  const id = parts[idIndex]!.toLowerCase();
  if (section === undefined) return { id, view: { kind: "board" } };
  if (section === "docs" && extra.length === 0) return { id, view: { kind: "docs", documentId } };
  return null;
}
