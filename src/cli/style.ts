/**
 * Terminal colors for humans. Output stays plain when it isn't going to a
 * terminal (agents, pipes, files), so scripts and agents never see escape codes.
 * Uses the 16 standard colors, which follow the terminal's own light/dark theme.
 */
import type { Priority } from "../shared/types";

type Paint = (text: string) => string;

export interface Style {
  enabled: boolean;
  bold: Paint;
  dim: Paint;
  underline: Paint;
  red: Paint;
  green: Paint;
  yellow: Paint;
  blue: Paint;
  cyan: Paint;
}

const code = (open: number, close: number): Paint => (text) => `\x1b[${open}m${text}\x1b[${close}m`;
const identity: Paint = (text) => text;

export function createStyle(enabled: boolean): Style {
  if (!enabled) {
    return { enabled, bold: identity, dim: identity, underline: identity, red: identity, green: identity, yellow: identity, blue: identity, cyan: identity };
  }
  return {
    enabled,
    bold: code(1, 22),
    dim: code(2, 22),
    underline: code(4, 24),
    red: code(31, 39),
    green: code(32, 39),
    yellow: code(33, 39),
    blue: code(34, 39),
    cyan: code(36, 39),
  };
}

export const plain = createStyle(false);

/**
 * Whether to color a stream. Precedence: --no-color / --color, then NO_COLOR
 * (https://no-color.org) and FORCE_COLOR, then whether the stream is a
 * terminal (and not TERM=dumb).
 */
export function colorEnabled(
  flags: Record<string, string | true>,
  isTTY: boolean | undefined,
  env: Record<string, string | undefined>,
): boolean {
  if (flags["no-color"]) return false;
  if (flags.color) return true;
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== "0" && env.FORCE_COLOR !== "false";
  return !!isTTY && env.TERM !== "dumb";
}

// -- semantic helpers, shared by every command so colors mean the same thing --

export const num = (s: Style, n: number | string) => s.dim(`#${n}`);
export const column = (s: Style, name: string) => s.bold(name);
export const person = (s: Style, name: string) => s.cyan(name);
export const link = (s: Style, url: string) => s.dim(s.underline(url));

export function priority(s: Style, p: Priority): string {
  if (p === "high") return s.red(p);
  if (p === "medium") return s.yellow(p);
  if (p === "low") return s.blue(p);
  return s.dim(p);
}

/** A success line: "✓ message" in color, the bare message otherwise. */
export const success = (s: Style, message: string) => (s.enabled ? `${s.green("✓")} ${message}` : message);
