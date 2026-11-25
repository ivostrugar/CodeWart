import { invoke } from "@tauri-apps/api/core";
import type {
  AgentSession,
  Attribution,
  CallGraph,
  CliStatus,
  Discovery,
  DiffResult,
  Editor,
  GraphScope,
  History,
  Project,
  PullRequest,
  ReviewAnswer,
  ReviewRequest,
  Selection,
} from "./types";

export const api = {
  launchPaths: () => invoke<string[]>("launch_paths"),
  launchReview: () => invoke<ReviewRequest | null>("launch_review"),
  launchAnswers: () => invoke<ReviewAnswer[]>("launch_answers"),
  /** Rewrite `wart` / the Claude skill if an earlier version installed them; returns what changed. */
  refreshInstalls: () => invoke<string[]>("refresh_installs"),
  reviewWaiting: (reply: string) => invoke<boolean>("review_waiting", { reply }),
  writeReviewReply: (reply: string, text: string) => invoke<void>("write_review_reply", { reply, text }),
  /** Bounce the Dock icon and notify, unless CodeWart is already in front. */
  reviewAlert: (title: string, body: string) => invoke<boolean>("review_alert", { title, body }),
  discover: (path: string) => invoke<Discovery>("discover", { path }),
  openProject: (path: string) => invoke<Project>("open_project", { path }),
  cliStatus: () => invoke<CliStatus>("cli_status"),
  installCli: () => invoke<CliStatus>("install_cli"),
  history: (worktree: string) => invoke<History>("history", { worktree }),
  diff: (worktree: string, selection: Selection, ignoreWhitespace: boolean) =>
    invoke<DiffResult>("diff", { worktree, selection, options: { ignoreWhitespace } }),
  attribution: (worktree: string, selection: Selection, ignoreWhitespace: boolean) =>
    invoke<Attribution>("attribution", { worktree, selection, options: { ignoreWhitespace } }),
  callGraph: (worktree: string, selection: Selection, scope: GraphScope) =>
    invoke<CallGraph>("call_graph", { worktree, selection, scope }),
  fingerprint: (worktree: string) => invoke<string>("fingerprint", { worktree }),
  readFile: (worktree: string, rev: string | null, path: string) => invoke<string | null>("read_file", { worktree, rev, path }),
  prStatus: (worktree: string, branch: string) => invoke<PullRequest | null>("pr_status", { worktree, branch }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  editorInfo: () => invoke<Editor | null>("editor_info"),
  openInEditor: (root: string, file?: string, line?: number) =>
    invoke<void>("open_in_editor", { root, file: file ?? null, line: line ?? null }),
  openInTerminal: (path: string) => invoke<void>("open_in_terminal", { path }),
  revealInFileManager: (path: string) => invoke<void>("reveal_in_file_manager", { path }),
  listSessions: (worktree: string) => invoke<AgentSession[]>("list_sessions", { worktree }),
  injectText: (session: string, text: string, submit: boolean) =>
    invoke<void>("inject_text", { session, text, submit }),
};

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
