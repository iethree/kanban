import { useSyncExternalStore } from "react";

export interface RecentProject {
  id: string;
  title: string;
  /** The project's colour when last visited; missing for entries saved before colours existed. */
  color?: string;
  visitedAt: number;
}

const KEY = "kanban.recent.v1";
const MAX = 100;
const listeners = new Set<() => void>();
let cache: RecentProject[] | null = null;

function read(): RecentProject[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
  return cache!;
}

function write(list: RecentProject[]) {
  cache = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage full or disabled; history is a convenience only.
  }
  listeners.forEach((l) => l());
}

export function rememberProject(id: string, title: string, color?: string) {
  const list = read().filter((p) => p.id !== id);
  write([{ id, title, ...(color ? { color } : {}), visitedAt: Date.now() }, ...list].slice(0, MAX));
}

export function forgetProject(id: string) {
  write(read().filter((p) => p.id !== id));
}

export function useRecentProjects(): RecentProject[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      const onStorage = (e: StorageEvent) => {
        if (e.key !== KEY) return;
        cache = null;
        cb();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", onStorage);
      };
    },
    read,
  );
}
