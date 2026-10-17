import type { Doc } from "./types";

/** Project colours: each one carries white text, in light and dark themes alike. */
export const PROJECT_COLORS = [
  "#386de6", // blue
  "#6a5ae0", // indigo
  "#9b51e0", // purple
  "#d6409f", // pink
  "#e5484d", // red
  "#e8590c", // orange
  "#c98a12", // amber
  "#2f9e5b", // green
  "#12a594", // teal
  "#0b8bc6", // cyan
  "#5b6573", // slate
  "#1b1b19", // ink, the app's own colour
] as const;

/** New projects get one of the colourful ones; ink stays available to pick. */
export const randomProjectColor = (): string => PROJECT_COLORS[Math.floor(Math.random() * (PROJECT_COLORS.length - 1))]!;

export const isColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

/** The project's colour; projects made before colours existed get a stable one from their creation time. */
export function projectColor(doc: Pick<Doc, "color" | "createdAt">): string {
  if (doc.color) return doc.color;
  return PROJECT_COLORS[Math.abs(Math.floor(doc.createdAt / 1000)) % (PROJECT_COLORS.length - 1)]!;
}

/** The app icon as an SVG data URL, for a project's favicon. */
export function faviconUrl(color: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'><rect x='1' y='1' width='18' height='18' rx='5' fill='${color}'/><rect x='5' y='5' width='2.6' height='10' rx='1.3' fill='white'/><rect x='8.7' y='5' width='2.6' height='6.5' rx='1.3' fill='white'/><rect x='12.4' y='5' width='2.6' height='8' rx='1.3' fill='white'/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
