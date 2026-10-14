import type { Doc } from "../../shared/types";
import { exportDoc, importDoc } from "../../shared/validate";

export function downloadProject(doc: Doc) {
  const slug = doc.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  const blob = new Blob([JSON.stringify(exportDoc(doc), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens a file picker and resolves with the parsed JSON (or null if cancelled). */
export function pickJsonFile(): Promise<{ name: string; data: unknown } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve({ name: file.name, data: JSON.parse(await file.text()) });
      } catch {
        reject(new Error(`${file.name} isn't valid JSON.`));
      }
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Validates locally (for a fast, friendly error) then uploads to the project. */
export async function uploadProject(projectId: string, data: unknown): Promise<Doc> {
  const doc = importDoc(data);
  const res = await fetch(`/api/p/${projectId}/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Import failed (${res.status})`);
  }
  return doc;
}
