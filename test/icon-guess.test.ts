import { afterEach, expect, test } from "bun:test";
import type { Column } from "../src/shared/types";
import { guessColumnIcons } from "../src/worker/icon-guess";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const col = (id: string, name: string): Column => ({ id, name, cardIds: [] });

test("asks one choice question per column and keeps only valid answers", async () => {
  let sent: any;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    sent = JSON.parse(String(init.body));
    return Response.json({
      model: "jev-1",
      answers: { c0: { type: "choice", choice: "in-review" }, c1: { type: "choice", choice: "bogus" } },
    });
  }) as typeof fetch;

  const columns = [col("a", "Backlog"), col("b", "With legal"), col("c", "Blocked")];
  const guesses = await guessColumnIcons("test-key", { title: "P", columns }, columns.slice(1));

  expect(sent.model).toBe("jev-latest");
  expect(sent.state.board.columns).toEqual(["Backlog", "With legal", "Blocked"]);
  expect(Object.keys(sent.questions)).toEqual(["c0", "c1"]);
  expect(sent.questions.c0.type).toBe("choice");
  expect(sent.questions.c0.instructions.column).toBe("With legal");
  expect(Object.keys(sent.questions.c0.criteria)).toEqual(["backlog", "todo", "in-progress", "in-review", "done", "cancelled"]);
  expect([...guesses]).toEqual([["b", "in-review"]]);
});

test("throws on an error response so the room can log it", async () => {
  globalThis.fetch = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
  await expect(guessColumnIcons("bad", { title: "P", columns: [] }, [col("a", "X")])).rejects.toThrow("Jev returned 401");
});
