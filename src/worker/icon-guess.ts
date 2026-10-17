import { COLUMN_ICONS, type ColumnIcon } from "../shared/column-icons";
import type { Column } from "../shared/types";

const JEV_URL = "https://api.typesafe.ai/v1/systemone";

const CRITERIA: Record<ColumnIcon, string> = {
  backlog: "Not yet planned: ideas, requests and someday work waiting to be prioritised",
  todo: "Planned and ready to be picked up next, but not started",
  "in-progress": "Actively being worked on right now",
  "in-review": "Work finished by its author and waiting on someone else: review, testing, QA, approval",
  done: "Finished, shipped or otherwise complete",
  cancelled: "Closed without being done: dropped, rejected, won't do, duplicate",
};

/**
 * Asks Jev which workflow stage each column stands for. The whole board is the
 * state, since order matters ("Shipped" at the far right is probably done).
 * One question per column, asked together so they run in parallel.
 */
export async function guessColumnIcons(
  apiKey: string,
  board: { title: string; columns: Column[] },
  targets: Column[],
): Promise<Map<string, ColumnIcon>> {
  const questions = Object.fromEntries(
    targets.map((column, i) => [
      `c${i}`,
      {
        type: "choice",
        instructions: {
          column: column.name,
          question:
            "Cards in the kanban board column named `column` are at which stage of their workflow? `board.columns` lists every column left to right, the order cards usually move in.",
        },
        criteria: CRITERIA,
      },
    ]),
  );
  const res = await fetch(JEV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "jev-latest",
      state: { board: { title: board.title, columns: board.columns.map((c) => c.name) } },
      questions,
    }),
  });
  if (!res.ok) throw new Error(`Jev returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { answers?: Record<string, { choice?: string }> };
  const guesses = new Map<string, ColumnIcon>();
  targets.forEach((column, i) => {
    const choice = body.answers?.[`c${i}`]?.choice;
    if (COLUMN_ICONS.includes(choice as ColumnIcon)) guesses.set(column.id, choice as ColumnIcon);
  });
  return guesses;
}
