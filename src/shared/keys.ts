/**
 * Project keys. A project with no keys is open to anyone with its link. Once it
 * has at least one, every read and edit needs one of them, so a link shared by
 * accident doesn't give the board away. Keys are random, never chosen by people,
 * and the server keeps only their SHA-256 hashes.
 */

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const KEY_LENGTH = 16;
export const KEY_RE = /^[0-9A-Za-z]{16}$/;
/** HTTP header that carries a key. The app's WebSocket, which can't set headers, sends it in its first message. */
export const KEY_HEADER = "X-Kban-Key";
/** The header's name from before the app was renamed to kban. Servers still accept it. */
export const OLD_KEY_HEADER = "X-Kanban-Key";
/** Close code for a WebSocket whose key is missing, wrong or revoked. */
export const KEY_CLOSE_CODE = 4401;

/**
 * What people without a key may do on a protected project: nothing ("none", the default), or look
 * at everything without changing it ("read").
 */
export const PUBLIC_ACCESS = ["none", "read"] as const;
export type PublicAccess = (typeof PUBLIC_ACCESS)[number];

/** What the server says about a key, without revealing the key itself. */
export interface KeyInfo {
  id: string;
  /** The key's first four characters, so people can tell keys apart. */
  hint: string;
  createdAt: number;
  /** True for the key the request was made with. */
  current: boolean;
}

/** A new random key: 16 base62 characters (about 95 bits). */
export function generateKey(): string {
  const out: string[] = [];
  const bytes = new Uint8Array(32);
  while (out.length < KEY_LENGTH) {
    crypto.getRandomValues(bytes);
    // 248 is the largest multiple of 62 below 256; rejecting the rest keeps every character equally likely.
    for (const b of bytes) if (b < 248 && out.length < KEY_LENGTH) out.push(ALPHABET[b % 62]!);
  }
  return out.join("");
}

export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const keyHint = (key: string) => key.slice(0, 4);
