# CodeWart

> CodeWart is a desktop app in which a human reviews code written by coding agents: diffs per commit or worktree, a call-chain diagram of changed functions, and line / function / whole-file review comments that go back to the agent. As an agent, use its `wart` command to show your work to the user and to ask for their review and wait for it.

CodeWart runs on the user's machine (macOS, Linux, Windows). It never edits code: it only reads git repositories and worktrees. Check that it is available with `command -v wart`. If it's missing, the user installs the app and clicks **Install `wart`** in its top bar.

## Commands

- `wart [PATH...]`: open a repository, any of its worktrees, or a folder of repositories (default: the current directory) in CodeWart. If CodeWart is running, it opens as a tab there. The command returns immediately. Use it to show the user what you changed.
- `wart review [-m MESSAGE] [--timeout SECS] [PATH]`: ask the user to review the worktree at PATH (default: current directory) and **wait** until they respond. The message is shown to the reviewer next to your changes: say briefly what you changed and what deserves a close look. Uncommitted changes are included. If PATH (or the current directory) is a folder holding several repos or worktrees (one feature across repos), the review covers all of them and the reply has one `## <repo>` section per repo with feedback.
  - Exit `0`: the response is on stdout (see below).
  - Exit `3`: `--timeout` passed with no response. The request stays open, so run the same command again to keep waiting. Use this when your shell tool has a time limit (e.g. Claude Code's Bash tool: at most 10 minutes, so use `--timeout 570` and re-run on exit 3).
  - Exit `1`: error (not a git repository, CodeWart not installed).
- `wart answer REVIEW_ID`: send your answers to a review's numbered comments back to CodeWart, on stdin, one entry per comment: `1. solved: <what you changed>` or `2. answered: <your reply>` (`answered` when you didn't change code: you disagree, explain, or ask). `0. answered: …` replies to the overall notes. Lines that follow an entry belong to it. The reviewer sees each answer under their comment. `REVIEW_ID` is on the review's last lines. Exit `0`: delivered; `1`: CodeWart didn't pick them up.
- `wart agent`: print this guide.

## Review responses

`wart review` prints exactly one of:

- `APPROVED: …`: no changes requested. Continue or finish.
- `DISMISSED: …`: the user doesn't want to review now. Continue without feedback.
- Review feedback in markdown, starting with `Review feedback on <what was reviewed>:`, then the reviewer's overall notes, then numbered comments. Each comment starts with its location, optionally followed by the code it refers to in a fenced block, and then the feedback:
  - `` `path/to/file.ts:14` `` or `` `path/to/file.ts:14-18` ``: lines in the reviewed version
  - `` `path/to/file.ts:7 (removed line)` ``: a line the change deleted
  - `` `refreshSession` in `src/session.ts:12` ``: a function (from the call-chain view)
  - `` `src/token.ts` (whole file) ``: the file as a whole

  It ends with `Review id: <id>` and how to answer (`wart answer <id>`). Comments are numbered straight through, also when the review covers several repos (`# Review of …` with one `## <repo>` section per repo).

Several responses that arrive before you collect them are joined with a line containing `---`.

Handle feedback by addressing every numbered comment and the overall notes. Line numbers refer to the version that was reviewed, so find the code by the quoted snippet if it has moved. Then answer every comment with `wart answer <id>` (see above) and summarise what you changed per comment number. If the user wants review rounds, request the next review the same way.

## Suggested instructions for AGENTS.md / CLAUDE.md

```markdown
When you finish a task, run `wart review -m "<what changed, what to check>"` and wait for my review
(re-run it if it exits 3). Address every comment it prints, answer each one with
`wart answer <review id>` (one line per comment: `1. solved: …` / `2. answered: …`), then ask for the next review.
```

Claude Code users can instead install the `codewart-review` skill (`make install-skill` in the CodeWart repository).

## More

- Source and docs: https://github.com/ivostrugar/CodeWart
- Downloads: https://github.com/ivostrugar/CodeWart/releases/latest
