---
name: codewart-review
description: Ask the user to review your code changes in CodeWart and wait for their feedback, then address it. Use when the user asks you to get their review, "request a review in CodeWart", "wait for my review", or to iterate on a task with review rounds; also at the end of a task when the user has asked to review your work before you continue.
---

# Review rounds with CodeWart

CodeWart is the user's desktop app for reviewing agent-written code. `wart review` opens the current worktree there, shows the user that you are waiting, and blocks until they send a review. It then prints the review to stdout.

## Request a review

1. Finish a coherent piece of work first. Uncommitted changes are fine: CodeWart shows them.
2. From the repository or worktree you changed, run (Bash tool, **with `timeout: 600000`**):

   ```sh
   wart review --timeout 570 -m "<2-4 lines: what you changed and what deserves a close look>"
   ```

   The message is shown to the reviewer next to your changes. Keep it short and concrete.

3. Read the exit code:
   - **0**: the review is on stdout. Go to *Handle the review*.
   - **3**: no review yet (the Bash tool can't wait longer than 10 minutes). Run **the exact same command again** right away. Keep going until you get exit 0. Don't end your turn or ask the user while waiting; they are reviewing.
   - **1** or `command not found`: CodeWart or its `wart` command isn't installed. Tell the user to install the app and click **Install `wart`** in its top bar, then stop.

## Handle the review

The output is one of:

- **`APPROVED: …`**: nothing to change. Tell the user in one line and continue with the task, or finish.
- **`DISMISSED: …`**: the user doesn't want to review now. Continue without feedback.
- **Review feedback** (markdown): starts with `Review feedback on …` (or `# Review of …` with one `## <repo>` section per repo), followed by overall notes and numbered comments. Each comment names a location like `` `src/session.ts:14-18` ``, `` `src/foo.ts:3 (removed line)` ``, `` `refreshSession` in `src/session.ts:12` `` or `` `src/token.ts` (whole file) ``, often with the code it refers to, then the feedback. The last lines give the **review id** (`Review id: r7k2m9`).
  1. Address **every** numbered comment and the overall notes. Line numbers refer to the version the user reviewed, so locate the code by the quoted snippet if lines have moved.
  2. If a comment is unclear or you disagree, don't guess: answer it (step 3) instead of changing code.
  3. **Answer every comment in CodeWart.** The user sees each answer under their comment. Run (Bash tool), with the review id from the review:

     ```sh
     wart answer r7k2m9 <<'EOF'
     1. solved: Moved the null check into refreshSession and added a test.
     2. answered: Kept the retry: the token endpoint returns 503 under load (see logs in #12).
     3. solved: Renamed to rotateToken everywhere.
     0. answered: Notes: split the PR as you suggested.
     EOF
     ```

     One entry per comment number, in the form `N. solved: …` (you changed code) or `N. answered: …` (a reply without a change: an explanation, disagreement or question). `0.` answers the overall notes. Keep each to one or two sentences. If the review covers several repos, the numbers run straight through, so answer them all in one call.
  4. Give the user a short summary too, mapping each comment number to what you did.
  5. If the user asked for review rounds, request the next review the same way. Mention in `-m` which comments you addressed.

Several reviews sent before you picked them up arrive together, separated by `---`. Handle all of them and answer each with its own review id.

If `wart answer` exits 1, mention it in your summary and continue; the answers are optional for the workflow.

`wart agent` prints the full reference (all commands, exit codes and the review format).
