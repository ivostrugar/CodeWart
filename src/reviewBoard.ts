import { useSyncExternalStore } from "react";
import type { PendingReview, ReviewComment, ReviewSession } from "./types";

/**
 * The review being written in each open tab. Tabs in the same scope (repos on
 * one branch, or the repos of one `wart review` folder request) show each
 * other's comments and are sent to the agent together, whichever tab sends.
 */
export interface BoardEntry {
  tabId: string;
  scope: string;
  repo: string;
  target: string;
  comments: ReviewComment[];
  note: string;
  /** A `wart review` request waiting on this tab. */
  request?: PendingReview;
  remove: (commentId: string) => void;
  /** Bring its tab to the front. */
  focus: () => void;
  /** Show this comment in its own tab. */
  jump: (c: ReviewComment) => void;
  /** It was sent as part of review `id` (comments carry their numbers): archive and clear it. */
  archive: (snap: { target: string; comments: ReviewComment[]; note: string; markdown: string; id: string }, via: "session" | "copy", sentTo?: string) => ReviewSession;
}

const entries = new Map<string, BoardEntry>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  for (const l of listeners) l();
};

export function publish(e: BoardEntry): void {
  entries.set(e.tabId, e);
  emit();
}

export function unpublish(tabId: string): void {
  cache.delete(tabId);
  if (entries.delete(tabId)) emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Live list of the other tabs in `scope` (with or without content), sorted by repo. */
export function useScopePeers(scope: string, tabId: string): BoardEntry[] {
  const v = useSyncExternalStore(subscribe, () => version);
  return peersOf(scope, tabId, v);
}

const cache = new Map<string, { key: string; list: BoardEntry[] }>();
function peersOf(scope: string, tabId: string, v: number): BoardEntry[] {
  const key = `${v}|${scope}`;
  const hit = cache.get(tabId);
  if (hit?.key === key) return hit.list;
  const list = [...entries.values()]
    .filter((e) => e.scope === scope && e.tabId !== tabId)
    .sort((a, b) => a.repo.localeCompare(b.repo));
  // Same members and data as before: keep the old array so memos hold.
  const same = hit && hit.list.length === list.length && hit.list.every((e, i) => e === list[i]);
  const out = same ? hit.list : list;
  cache.set(tabId, { key, list: out });
  return out;
}

export const hasContent = (e: { comments: ReviewComment[]; note: string }) => e.comments.length > 0 || !!e.note.trim();
