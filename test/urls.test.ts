import { describe, expect, test } from "bun:test";
import { parseProjectPath, projectPath, slugify } from "../src/shared/urls";

const ID = "3c5f5d83-d805-4e41-bba5-7a69e0ea588b";
const SHORT = "1pv7XjjQP9gM4BRBqypgrb";

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
    expect(parseProjectPath(`/p/my-board/${ID}/docs`)).toEqual({
      id: ID,
      view: { kind: "docs", documentId: undefined },
    });
    expect(parseProjectPath(`/p/my-board/${ID}/docs/abc123`)).toEqual({
      id: ID,
      view: { kind: "docs", documentId: "abc123" },
    });
  });

  test("project paths use the short id and resolve to the UUID", () => {
    expect(projectPath(ID, "My board")).toBe(`/p/my-board/${SHORT}`);
    expect(projectPath(SHORT, "My board", "/docs")).toBe(`/p/my-board/${SHORT}/docs`);
    expect(parseProjectPath(`/p/my-board/${SHORT}/docs/abc123`)).toEqual({
      id: ID,
      view: { kind: "docs", documentId: "abc123" },
    });
    expect(parseProjectPath(`/p/${SHORT}`)?.id).toBe(ID);
    expect(parseProjectPath(`/p/${SHORT}/docs`)?.view).toEqual({ kind: "docs", documentId: undefined });
  });

  test("list view", () => {
    expect(parseProjectPath(`/p/my-board/${SHORT}/list`)).toEqual({ id: ID, view: { kind: "list" } });
    expect(parseProjectPath(`/p/${SHORT}/list/`)?.view).toEqual({ kind: "list" });
    expect(parseProjectPath(`/p/x/${SHORT}/list/extra`)).toBeNull();
  });

  test("a name that looks like an id doesn't shadow the real id", () => {
    expect(parseProjectPath(`/p/abcdefghijklmnopqrstuv/${SHORT}`)?.id).toBe(ID);
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
