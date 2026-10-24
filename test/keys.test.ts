import { expect, test } from "bun:test";
import { KEY_RE, generateKey, hashKey, keyHint } from "../src/shared/keys";
import { applyOp, emptyDoc } from "../src/shared/reducer";
import type { Op } from "../src/shared/types";
import { projectLlmsTxt } from "../src/worker/llms";

test("keys are 16 random base62 characters", () => {
  const keys = Array.from({ length: 500 }, generateKey);
  for (const key of keys) expect(key).toMatch(KEY_RE);
  expect(new Set(keys).size).toBe(keys.length);
  // Every character of the alphabet turns up, so no part of it is skipped.
  expect(new Set(keys.join("")).size).toBe(62);
});

test("keys are stored as SHA-256 hashes and shown by their first characters", async () => {
  expect(await hashKey("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  expect(keyHint("AbCd1234EfGh5678")).toBe("AbCd");
});

test("a protected project's llms.txt sends the key in its examples", () => {
  const init: Op = { type: "init", title: "T", description: "", color: "#000000", columns: [{ id: "a", name: "Todo" }] };
  const doc = applyOp(emptyDoc(), init, 1);
  const id = "3c5f5d83-d805-4e41-bba5-7a69e0ea588b";
  const open = projectLlmsTxt(doc, "https://x.test", id);
  const locked = projectLlmsTxt(doc, "https://x.test", id, true);
  expect(open).not.toContain("$KANBAN_KEY");
  expect(locked).toContain('curl -s -H "X-Kanban-Key: $KANBAN_KEY" https://x.test/api/p/');
  expect(locked).toContain("--key <key>");
  expect(locked).toContain("It is protected");
  const guest = projectLlmsTxt(doc, "https://x.test", id, true, true);
  expect(guest).toContain("you can read it but not change it");
});
