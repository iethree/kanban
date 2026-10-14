import { describe, expect, test } from "bun:test";
import { parseProjectPath, projectPath, slugify } from "../src/shared/urls";

const ID = "3c5f5d83-d805-4e41-bba5-7a69e0ea588b";

describe("slugify", () => {
  test("makes readable slugs", () => {
    expect(slugify("Website relaunch (Q4)")).toBe("website-relaunch-q4");
    expect(slugify("Café déjà vu")).toBe("cafe-deja-vu");
    expect(slugify("  ")).toBe("project");
    expect(slugify("🚀🚀")).toBe("project");
    expect(slugify("a".repeat(100)).length).toBe(60);
  });
});

describe("parseProjectPath", () => {
  test("canonical paths", () => {
    expect(parseProjectPath(projectPath(ID, "My board"))).toEqual({ id: ID, view: { kind: "board" } });
    expect(parseProjectPath(`/p/my-board/${ID}/docs`)).toEqual({ id: ID, view: { kind: "docs", documentId: undefined } });
    expect(parseProjectPath(`/p/my-board/${ID}/docs/abc123`)).toEqual({ id: ID, view: { kind: "docs", documentId: "abc123" } });
  });

  test("the name is ignored, and legacy /p/<uuid> links still work", () => {
    expect(parseProjectPath(`/p/an-old-name/${ID}`)?.id).toBe(ID);
    expect(parseProjectPath(`/p/${ID}`)?.id).toBe(ID);
    expect(parseProjectPath(`/p/${ID}/docs/abc`)?.view).toEqual({ kind: "docs", documentId: "abc" });
    expect(parseProjectPath(`/p/Name/${ID.toUpperCase()}/`)?.id).toBe(ID);
  });

  test("rejects other paths", () => {
    expect(parseProjectPath("/")).toBeNull();
    expect(parseProjectPath("/p/not-a-uuid")).toBeNull();
    expect(parseProjectPath(`/p/a/b/${ID}`)).toBeNull();
    expect(parseProjectPath(`/p/x/${ID}/settings`)).toBeNull();
    expect(parseProjectPath(`/p/x/${ID}/docs/a/b`)).toBeNull();
  });
});
