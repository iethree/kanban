/** The Claude Code skill that `kban install-skill` writes, so `/kban next` works the board's Todo column. */
export function claudeSkill(origin: string): string {
  return `---
name: kban
description: Work through the kanban board linked in this repository's .kban (or .kanban) file. Use when the user runs /kban next, or asks you to work through, pick up or check the cards on their kanban board.
argument-hint: "next [instructions, e.g. deploy each card]"
---

# kban board

The work in this repository is tracked on a shared kanban board. The \`kban\` CLI finds the board through the
nearest \`.kban\` file (or \`.kanban\`, its older name), which it looks for in the current directory and then in each parent directory.
People can watch and edit the board while you work.

Arguments: $ARGUMENTS

## Before you start

1. Run \`kban url\`. If it says that no project is linked, stop. Tell the user to run
   \`kban init <project-url>\`.
2. If the \`kban\` command is not found, stop. Tell the user to install it with
   \`curl -fsSL ${origin}/install | sh\`.
3. If that file has no \`agent\` field, add \`--as claude\` to each \`start\`, \`log\`, \`done\` and \`claim\` command.
   This puts your name on claims and notes.

## \`next\`: work through the Todo column

Do these steps for each card. Do not stop after the first card.

1. Run \`kban next --json\`. It gives the highest-priority unclaimed card in the Todo column (a column named
   like "Todo", "Next" or "Ready", or else the first column). If the result is \`null\`, the column has no more
   work: go to "When you finish".
2. Run \`kban start <number>\` to claim the card and move it to the in-progress column. If the command exits
   with code 3, someone else claimed the card first: go back to step 1.
3. Read the card's title and description. They are the specification. Read the code that the card is about.
4. If the card is unclear, or it needs a decision that only the user can make, run
   \`kban log <number> "**Blocked:** <your question>"\`. Leave the card where it is and go back to step 1.
5. Do the work. Obey the repository's instructions (for example CLAUDE.md or AGENTS.md) and match its
   conventions. Add or update tests, then run the tests and the type checks.
6. Make one commit for the card, before you start the next card. Put all of the card's changes, and no
   changes for other cards, in that commit. Do not combine cards in one commit, and do not split a card into
   several commits. If the arguments above or the repository's instructions tell you not to commit, do not.
   Push or deploy only if the arguments above or the repository's instructions tell you to.
7. When the work is complete and verified, run \`kban done <number> "<one line: what changed>"\`. In that
   line, give the commit hash, or say that the change is not committed. If you cannot finish the card, run
   \`kban log <number> "<what is done and what remains>"\` and leave the card in progress.
8. Go back to step 1. People can add cards while you work, so always run \`kban next\` again.

## When you finish

Give the user a short report. For each card, give its number, its title and the result. Identify each
card that is blocked, not finished or not committed.

## Other arguments

If the arguments do not start with \`next\`, they are a request about the board, for example
\`/kban add a card for the login bug\` or \`/kban what is in progress?\`. Use the CLI to do the request.
Run \`kban help\` to see all the commands.
`;
}
