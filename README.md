# CodeWart

A desktop helper for reviewing code written by coding agents. Point it at a repo or any of its worktrees, step through what the agent did commit by commit, follow new functions through a call-chain diagram, and send review comments straight back to the agent session.

Built with Tauri 2 (Rust) + React. Runs on macOS, Linux and Windows.

## Quick start

```sh
make setup      # check toolchains, install npm deps, fetch crates
make dev        # run with hot reload, opening this repo
make dev P=~/work/api.feat-x   # …or any repo / worktree
make install    # build, install the app and the `wart` CLI
```

Node.js and npm are optional on the host: when absent, npm runs automatically in
the official Node 22 Docker image. Docker must be running; Rust stays on the host
because Tauri builds a native app for the current platform.

Then, from any project root, worktree, or folder of repos:

```sh
wart .              # opens the current directory
wart ../other       # if CodeWart is already running, opens as a new tab
```

`codewart` is installed as an alias of `wart`.

## Using CodeWart with coding agents

CodeWart works with any coding agent that edits a git checkout (Claude Code, Codex, Aider, Gemini CLI, Cursor's agent …). Agents learn how to use it from `wart agent`, which prints [`docs/agents.md`](docs/agents.md).

### Recommended setup

1. **One worktree per agent task.** `git worktree add ../api.login -b feat/login`, then start the agent there. CodeWart groups tabs by branch, so related repos on the same feature branch sit together, and you can review one agent while others keep working.
2. **Open it with Follow agent on.** Run `wart .` in the worktree. CodeWart jumps to each new commit or uncommitted edit as the agent makes it.
3. **Review in rounds:** read the diff (hide tests and noise with the filters), check the call chain for new functions and who calls them, and comment on lines, functions or whole files.
4. **Hand the review back.** Either let the agent ask for it (below), use **Send to session** (agent running in tmux, WezTerm or kitty), or **Copy** and paste. Every handed-over review is archived as a numbered session in the review pane.

### Let the agent ask for your review

`wart review` blocks until you send your review in CodeWart, then prints it, so the agent can work in review rounds without any terminal integration.

**Claude Code: install the skill.** `make install` (or `make install-skill`) copies [`skills/codewart-review`](skills/codewart-review/SKILL.md) to `~/.claude/skills`. A shortened version of what it tells Claude:

```markdown
---
name: codewart-review
description: Ask the user to review your code changes in CodeWart and wait for their feedback,
  then address it. Use when the user asks for their review or for review rounds.
---

1. Finish a coherent piece of work, then run (Bash tool, timeout 600000):
   wart review --timeout 570 -m "<what you changed, what deserves a close look>"
2. Exit 3 means no review yet: run the same command again. Exit 0: the review is on stdout.
3. APPROVED → continue. DISMISSED → continue without feedback.
   Otherwise address every numbered comment (find code by its quoted snippet if lines moved)
   and summarise your changes per comment number. Request the next round the same way.
```

Then prompt it like this:

- *"Implement token rotation in `src/session.ts`, then get my review in CodeWart and address it."*
- *"Fix the flaky login test. Work in review rounds with me in CodeWart until I approve."*
- *"Refactor the router; ask for my review after each step."*

**Other agents: add a few lines to the repo's `AGENTS.md`** (or `CLAUDE.md`, `GEMINI.md`, `CONVENTIONS.md` …):

```markdown
## Code review
When you finish a task, run `wart review -m "<what changed, what to check>"` and wait for my review
(re-run it if it exits 3). Address every comment it prints, then ask for the next review.
If it prints APPROVED, you're done. Run `wart agent` for details.
```

### Tips

- **Tell the agent what to look at.** The `-m` message is shown above the review. "Changed the retry logic; the backoff math in `retry.ts:40` is the risky part" leads to a faster, better review.
- **Approve when there's nothing to fix.** "approve, no changes" releases the agent with `APPROVED`; "dismiss" releases it without feedback.
- **Comment at the right level:** a line for local fixes, a function (from the call chain) for design issues, the whole file for structure or naming.
- **Use the review history.** Past sessions show exactly what you asked for in each round, which helps check that every comment was addressed.
- **Watch the PR pill:** tabs show the branch's GitHub PR and its state (via `gh`), so you can see what is already up for review.

## Installing on other machines

Tauri builds native installers per OS (it can't cross-compile):

| Command | Output |
| --- | --- |
| `make dist` on macOS | `release/CodeWart_<v>_universal.dmg` + `.app.zip` (Apple Silicon + Intel) |
| `make dist` on Linux | `.deb`, `.AppImage`, `.rpm` |
| `make dist` on Windows | `.msi` and setup `.exe` |
| `make release` | tags `v<version>` and pushes; `.github/workflows/release.yml` builds all three platforms, attaches them to a GitHub release and publishes it once every platform succeeded |

Every release also carries copies under stable names, so `https://github.com/ivostrugar/CodeWart/releases/latest/download/CodeWart-macos-universal.dmg` (and the `-windows-x64-setup.exe`, `-windows-x64.msi`, `-linux-amd64.AppImage`, `-linux-amd64.deb`, `-linux-x86_64.rpm` variants) always serves the newest version.

### Landing page

`site/` is a static landing page with download buttons for those links. `.github/workflows/pages.yml` publishes it to GitHub Pages on every push to `main` that touches `site/` (one-time setup: **Settings → Pages → Source: GitHub Actions**). Preview it locally with `python3 -m http.server -d site`.

On the other machine, install the app, open it once and click **Install `wart`** in the top bar. This writes a launcher that points at wherever the app is installed:

* macOS/Linux: into `~/.local/bin`, `~/bin`, `/usr/local/bin` or `/opt/homebrew/bin`, whichever is on `PATH` and writable
* Windows: `wart.cmd` into `%LOCALAPPDATA%\Microsoft\WindowsApps`

**macOS Gatekeeper:** unsigned builds are blocked on other Macs ("app is damaged / can't be opened"). Either right-click → Open once, or run `xattr -dr com.apple.quarantine /Applications/CodeWart.app`. For proper distribution, add the Apple signing secrets listed in `release.yml` and CI signs and notarizes the build.

**Linux:** the app needs WebKitGTK 4.1 (`libwebkit2gtk-4.1-0`), which the `.deb` declares.

Run `make` to see every command.

## Layout

| Row | Contents |
| --- | --- |
| 1 | Tabs of open projects (repos opened together from one folder form a colour-framed group that moves as one), `+` to open another, theme toggle |
| 2 | Worktree / branch dropdown · commits ahead / uncommitted stats · **Diff ⇄ Call chain** toggle |
| 3 | Back · related repos of the group (quick jump) · filter pills (hide tests, hide non-functional, ignore whitespace) · open in editor / terminal / Finder |
| Left | Commit history of the branch since it forked from the default branch, plus uncommitted work. Modes: `single`, `range` (click two commits or shift-click), `all` |
| Centre | Unified diff of the selection, or the call-chain canvas |
| Right | Changed files (scrolls), then the review: line comments plus markdown notes, copied to the clipboard or sent to the agent session |

### Project identification

Open a project from its main checkout or from any linked worktree and you get the same tab: CodeWart resolves the main worktree via `git worktree list` and lists all its siblings in the dropdown. The default branch comes from `origin/HEAD`, falling back to `main`, `master`, `trunk` or `develop`.

### Multi-repo folders

Open a folder that isn't a repository itself but contains several (up to two levels deep), e.g. a feature folder with worktrees of `api/` and `web/`. Every repository opens as a tab in one **group**: a colour-framed set of adjacent tabs with the folder name. Drag the group label to move the whole group, or close it with the group's ×.

Next to the Back button, the other repos of the group appear as pills. Clicking one switches to it **on its worktree for the same branch**, if it has one (green outline). Otherwise it switches to that repo's current worktree.

### Filters

* **Hide tests**: `*.test.*`, `*.spec.*`, `*_test.go`, `test_*.py`, `tests/`, `__tests__/`, fixtures, snapshots…
* **Hide non-functional**: lockfiles, assets and binaries, generated or minified code, docs, editor/tool config, pure renames, and files where only whitespace or only comments changed.
* **Ignore whitespace**: passes `-w` to git, so indentation-only hunks disappear inside the files that remain.

* **Hide merged-in** (shown when the branch has merges): hides code that came in through merges from other branches. Those commits are marked *merged in* in the history.

Hidden files are listed under the file list with the reason each was hidden, and you can bring them back.

### Which commit is this?

When the selection spans several commits (a range, `all`, or a merge), each run of changed lines is labelled with the commit it came from (via `git blame`) and gets that commit's colour in the gutter. From the label: **only this** shows just that commit, **hide** removes its changes from the diff. In the history every commit of the selection has a checkbox (or ⌘-click the row) to hide or show its changes.

### Call chain

The canvas shows every function the selection **added, changed, moved or deleted**. When one of them calls another, they're drawn as a connected flow (left to right, caller → callee). New call sites are drawn in the accent colour. Functions with no connections are shown as cards with a small diff of their change. Switch to **+ callers & callees** to also show unchanged neighbours, including callers anywhere in the repo (found with `git grep`).

Click a function for details, double-click to jump to it in the diff, or comment on it directly. Drag to pan; ⌘/ctrl + scroll to zoom.

Extraction is heuristic and has no per-language dependencies: comments and strings are masked out, definitions are matched per language, and bodies are delimited by braces or indentation. Supported: Rust, TypeScript/JavaScript (including object-literal methods), Python, Go, Ruby, Java, Kotlin, Swift, C/C++, C#, PHP, Scala and Dart. Calls are resolved by name, so a heavily overloaded name can link to the wrong target.

### Sending reviews to the agent

Click any line in the diff to comment; drag over line numbers or shift-click for a range. Click a comment (or its line) again to edit it. Comments collect in the review pane together with free-form markdown. Then either:

* **Copy**: the compiled markdown (file:line, optional code snippet, comment) goes to the clipboard, ready to paste anywhere.
* **Send to session**: CodeWart finds terminal panes whose working directory is inside the worktree in **tmux**, **WezTerm** or **kitty** (with `allow_remote_control`), puts agent panes (Claude Code, Codex, Aider, Gemini…) first, and pastes the review there. "Press Enter after send" submits it.

### Reviews requested by the agent (`wart review`)

An agent can ask for your review and wait for it, in any terminal:

```sh
wart review -m "Added token rotation; check the expiry math" [--timeout SECS] [PATH]
```

CodeWart opens the worktree (without stealing focus; the Dock icon bounces), marks its tab with a pulsing dot and shows the agent's message above the review. **Send to agent** hands the review to the waiting command, which prints it and exits 0. The review is archived as a numbered session. **Approve, no changes** and **dismiss** release the agent with `APPROVED: …` / `DISMISSED: …`. With `--timeout` the command exits 3 if nothing arrived yet; running it again keeps waiting on the same request.

Run it from a folder that holds several repos (for example one feature's worktrees of `api/` and `web/`) and a single request covers all of them: every repo's tab shows it, and sending from any of them hands the agent one review with a section per repo.

**Claude Code skill:** `make install` (or `make install-skill`) installs `skills/codewart-review` into `~/.claude/skills`. It teaches Claude to run `wart review` when you ask for a review (or review rounds), to re-run it past the Bash tool's 10-minute limit, and to address every comment. Try: *"implement X, then get my review in CodeWart"*.

**Any agent:** `wart agent` prints [`docs/agents.md`](docs/agents.md), a guide for coding agents (what CodeWart is for, the commands, the review format and an AGENTS.md snippet). `wart --help` points to it, and the landing page serves the same file as `llms.txt`.

Under the hood the request and reply go through `$TMPDIR/codewart-reviews/review-<id>.md` (one per worktree). `wart review` is available with the macOS/Linux launcher.

### Follow agent

With **Follow agent** on, CodeWart polls the worktree (HEAD + `git status` + file mtimes) every 1.5 s. It reloads when anything changes and jumps to the newest commit or the uncommitted work.

## Keyboard

| Key | Action |
| --- | --- |
| `j` / `k`, `↓` / `↑` (history focused) | next / previous commit; `⇧↓` / `⇧↑` grow a range |
| `⌥F` / `⌘F` | find in the diff (starts with the selected text); `⏎` / `⇧⏎` next / previous match |
| `⌘B` | show / hide the history |
| `[` / `]` | previous / next file |
| `v` | toggle diff / call chain |
| `r` | refresh |
| `⏎` / `⇧⏎` | submit comment / new line in comment |
| `⌥←` | back |

## Configuration

| Env var | Purpose |
| --- | --- |
| `CODEWART_EDITOR` | editor command, e.g. `code`, `cursor`, `zed`, `idea`. Default: first one found on `PATH` (Cursor, VS Code, Zed, Windsurf, Sublime, JetBrains…) |
| `CODEWART_TERMINAL` | terminal app (macOS, e.g. `iTerm`) or command (Linux/Windows). Default: Ghostty / iTerm / Warp / WezTerm / kitty / Alacritty if installed, else Terminal |
| `CODEWART_APP`, `CODEWART_BIN` | where the `codewart` launcher looks for the app |

## Project structure

```
src/                      React UI
  components/Workspace    per-project state: selection, loading, follow, keyboard
  components/DiffView     stacked unified diff with inline comments
  components/CallGraphView canvas call-chain renderer (layout, pan/zoom, hit testing)
src-tauri/src/
  git.rs                  git CLI wrapper, project/worktree discovery, history
  diff.rs                 selection → git diff, unified diff parser
  classify.rs             test / non-functional detection
  callgraph.rs            function extraction and call graph
  session.rs              tmux / WezTerm / kitty discovery and injection
  actions.rs              editor, terminal, file manager
  e2e_tests.rs            tests against a real temp repo with a worktree
assets/brand/             logo, signet, wordmark, app icons (see its README)
scripts/wart              CLI launcher (`wart`, alias `codewart`)
site/                     landing page for GitHub Pages
```

`make test` runs the Rust unit and end-to-end tests plus the TypeScript type-check. `make ci` also checks formatting, clippy and the production UI build.

## License

[MIT](LICENSE) © Byte Brothers
