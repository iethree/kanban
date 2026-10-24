/**
 * Self-update: an installed CLI checks its server's /kanban.version at most once a day and, when the
 * server has a newer version, replaces its own file the way the installer does.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 3000;

/** True if version `a` (e.g. "1.10.0") is newer than `b`. Anything unparseable is never newer. */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => (/^\d+(\.\d+)*$/.test(v.trim()) ? v.trim().split(".").map(Number) : null);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

/** Whether to check automatically: never when turned off, in CI, or within a day of the last check. */
export function shouldAutoCheck(env: Record<string, string | undefined>, lastCheck: number | null, now: number): boolean {
  if (env.KANBAN_NO_UPDATE || env.CI) return false;
  return lastCheck === null || now - lastCheck >= CHECK_INTERVAL_MS || now < lastCheck;
}

function stampPath(env: Record<string, string | undefined>): string {
  return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "kanban", "last-update-check");
}

export function readLastCheck(env: Record<string, string | undefined>): number | null {
  try {
    const n = Number(readFileSync(stampPath(env), "utf8").trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeLastCheck(env: Record<string, string | undefined>, now: number) {
  try {
    const path = stampPath(env);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${now}\n`);
  } catch {
    // Not being able to record the check only means checking again next time.
  }
}

async function fetchText(url: string, version: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": `kanban-cli/${version}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

export type UpdateResult = { updated: false; latest: string } | { updated: true; from: string; to: string; path: string };

/** Downloads the CLI from `origin` over the running script if the server has a newer version. */
export async function selfUpdate(origin: string, current: string, env: Record<string, string | undefined>): Promise<UpdateResult> {
  writeLastCheck(env, Date.now());
  const latest = (await fetchText(`${origin}/kanban.version`, current)).trim();
  if (!isNewer(latest, current)) return { updated: false, latest };

  const script = process.argv[1];
  if (!script) throw new Error("can't tell where this CLI is installed");
  const path = realpathSync(script);
  const download = await fetchText(`${origin}/kanban.js`, current);
  if (!download.startsWith("#!")) throw new Error(`the download from ${origin}/kanban.js doesn't look like the CLI`);
  // Keep this file's shebang, which the installer pointed at the runtime that's available.
  const shebang = readFileSync(path, "utf8").split("\n", 1)[0]!;
  const next = `${shebang}\n${download.slice(download.indexOf("\n") + 1)}`;

  const tmp = `${path}.update-${process.pid}`;
  try {
    writeFileSync(tmp, next);
    chmodSync(tmp, 0o755);
    // Check the new copy runs before replacing anything, like the installer does.
    const check = spawnSync(process.execPath, [tmp, "--version"], { encoding: "utf8", timeout: 10_000, env: { ...env, KANBAN_NO_UPDATE: "1" } });
    if (check.status !== 0) throw new Error(`the downloaded CLI failed to run: ${(check.stderr || check.stdout || "").trim()}`);
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
  return { updated: true, from: current, to: latest, path };
}
