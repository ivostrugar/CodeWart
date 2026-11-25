export interface Worktree {
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  /** Last activity (unix seconds): newest of HEAD's commit and uncommitted edits. */
  updated: number;
}

/** GitHub pull request for a branch (via the `gh` CLI). */
export interface PullRequest {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | "" | null;
}

export interface Project {
  id: string;
  name: string;
  mainRoot: string;
  openedWorktree: string;
  worktrees: Worktree[];
  defaultBranch: string | null;
}

export interface Commit {
  sha: string;
  short: string;
  subject: string;
  author: string;
  time: number;
  parents: string[];
  additions: number;
  deletions: number;
  files: number;
  /** Came in through a merge from another branch. */
  foreign: boolean;
}

export interface WorkingStats {
  files: number;
  additions: number;
  deletions: number;
}

export interface History {
  branch: string | null;
  defaultBranch: string | null;
  commits: Commit[];
  base: Commit | null;
  working: WorkingStats | null;
  head: string | null;
}

export type Selection =
  | { kind: "working" }
  | { kind: "commit"; sha: string }
  | { kind: "range"; from: string; to: string | null }
  | { kind: "branch" };

export interface DiffLine {
  kind: "ctx" | "add" | "del";
  old: number | null;
  new: number | null;
  text: string;
  /** Commit the change came from (multi-commit selections; "working" = uncommitted). */
  commit?: string;
}

/** Which commit each changed line of a multi-commit diff came from. */
export interface Attribution {
  /** Commits that came in through a merge from another branch. */
  foreign: string[];
  /** Commits in the selection, oldest first ("working" last when included). */
  commits: string[];
  files: Record<string, { add: [number, string][]; del: [number, string][] }>;
}

/** Display info for a commit named on diff lines. */
export interface CommitBadge {
  sha: string;
  short: string;
  subject: string;
  /** Merged in from another branch (or the merge commit itself). */
  foreign: boolean;
  hidden: boolean;
  /** Colour index (0–5). */
  tone: number;
}

export interface Hunk {
  header: string;
  section: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export type FileTag =
  | "test"
  | "lockfile"
  | "asset"
  | "generated"
  | "docs"
  | "config"
  | "rename"
  | "whitespace"
  | "comments"
  | "commit"
  | "merged";

export interface FileDiff {
  path: string;
  oldPath: string | null;
  status: "added" | "deleted" | "modified" | "renamed" | "copied";
  binary: boolean;
  similarity: number | null;
  additions: number;
  deletions: number;
  hunks: Hunk[];
  tags: FileTag[];
  truncated: boolean;
}

export interface DiffResult {
  files: FileDiff[];
  oldRev: string;
  newRev: string | null;
}

export interface SnippetLine {
  kind: "ctx" | "add" | "del";
  text: string;
  line: number | null;
}

export interface GraphNode {
  id: string;
  name: string;
  container: string | null;
  file: string;
  line: number;
  endLine: number;
  status: "added" | "modified" | "deleted" | "moved" | "context";
  movedFrom: string | null;
  additions: number;
  deletions: number;
  signature: string;
  snippet: SnippetLine[];
  /** Whole function: current code with this selection's changes interleaved. */
  body: DiffLine[];
  isTest: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  isNew: boolean;
}

export interface CallGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  skippedFiles: string[];
}

export type GraphScope = "changed" | "neighbours";

export interface Editor {
  id: string;
  label: string;
}

export interface AgentSession {
  id: string;
  label: string;
  cwd: string;
  command: string;
  isAgent: boolean;
}

export interface ReviewComment {
  id: string;
  file: string;
  /** Line number on the side the comment was made on; 0 = the whole file. */
  line: number;
  endLine?: number;
  side: "new" | "old";
  /** The code being commented on. */
  code: string;
  body: string;
  /** Set when made from the call graph. */
  symbol?: string;
  /** Its number in the review it was sent in (what the agent's answers refer to). */
  num?: number;
}

/** The agent's answer to one comment (`wart answer`). */
export interface CommentAnswer {
  status: "solved" | "answered";
  text: string;
  /** When it arrived (ms since epoch). */
  at: number;
}

/** A comment from an earlier review round, shown faintly in the diff. */
export interface Ghost {
  comment: ReviewComment;
  /** Review round (#n) it was sent in. */
  round: number;
  answer?: CommentAnswer;
}

export interface Filters {
  hideTests: boolean;
  hideNonFunctional: boolean;
  ignoreWhitespace: boolean;
  /** Hide code that came in through merges from other branches. */
  hideForeign?: boolean;
}

export type View = "diff" | "calls";
export type HistoryMode = "single" | "range" | "all";

export type Discovery =
  | { kind: "repo"; path: string }
  | { kind: "group"; name: string; root: string; repos: string[] };

export interface CliStatus {
  installed: boolean;
  path: string;
  onPath: boolean;
}

/** Several repositories opened together from one folder. */
export interface RepoGroup {
  root: string;
  name: string;
}

/** Another repo in the same group, for quick switching. */
export interface Peer {
  id: string;
  name: string;
  /** The repo after this one in the group (for cycling). */
  isNext: boolean;
  worktree: string;
  worktrees: Worktree[];
}

/** A review that was handed to the agent, kept so past rounds stay visible. */
export interface ReviewSession {
  /** 1, 2, 3 … per worktree. */
  n: number;
  /** When it was handed over (ms since epoch). */
  at: number;
  /** What was reviewed, e.g. "commit abc1234 (…) on `feat/x`". */
  target: string;
  via: "session" | "copy";
  /** Terminal pane it was sent to (via = "session"). */
  sentTo?: string;
  comments: ReviewComment[];
  note: string;
  markdown: string;
  /** Review id the agent answers with (`wart answer <id>`). */
  id?: string;
  /** The agent's answers, by comment id. */
  answers?: Record<string, CommentAnswer>;
  /** Anything the agent wrote that wasn't an answer to a numbered comment. */
  reply?: string;
}

/** `wart answer <id>`: the agent's answers to a review's comments. */
export interface ReviewAnswer {
  review: string;
  text: string;
}

/** `wart review` from an agent: a worktree waiting for a review. */
export interface ReviewRequest {
  path: string;
  /** File the review is written to (the waiting launcher prints it). */
  reply: string;
  message?: string | null;
}

/** A review request as shown on a tab. */
export interface PendingReview {
  reply: string;
  message: string;
  /** When it was requested (ms since epoch). */
  at: number;
  /** Requested for a folder of repos: its name and how many repos share the request. */
  group?: { name: string; repos: number };
}
