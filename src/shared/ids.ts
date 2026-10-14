/**
 * Project ids are UUIDs internally (they name the Durable Object), but URLs use
 * a 22-character base62 encoding of the same 128 bits. The two forms convert
 * losslessly, so either one identifies a project. Note base62 is case-sensitive.
 */

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = 62n;
const SHORT_LENGTH = 22; // ceil(128 / log2(62))
const MAX = (1n << 128n) - 1n;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SHORT_ID_RE = /^[0-9A-Za-z]{22}$/;

/** UUID → 22-char base62. Accepts either form; returns the short one. */
export function toShortId(id: string): string {
  if (SHORT_ID_RE.test(id)) return id;
  let n = BigInt(`0x${id.replace(/-/g, "")}`);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % BASE)] + out;
    n /= BASE;
  }
  return out.padStart(SHORT_LENGTH, "0");
}

/**
 * Returns the canonical (lowercase) UUID for a project id in either form, or
 * null if it isn't a valid id.
 */
export function toProjectUuid(id: string): string | null {
  if (UUID_RE.test(id)) return id.toLowerCase();
  if (!SHORT_ID_RE.test(id)) return null;
  let n = 0n;
  for (const char of id) n = n * BASE + BigInt(ALPHABET.indexOf(char));
  // 22 base62 digits can exceed 128 bits; those strings don't map to a UUID.
  if (n > MAX) return null;
  const hex = n.toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isProjectId(id: string): boolean {
  return toProjectUuid(id) !== null;
}
