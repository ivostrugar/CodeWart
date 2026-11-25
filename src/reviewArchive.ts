import { useCallback, useEffect, useState } from "react";
import type { ReviewSession } from "./types";

/** Past review sessions per worktree, newest first, kept in localStorage. */
export const ARCHIVE_PREFIX = "codewart.reviews:";
const MAX = 200;
/** Fired on window (detail: worktree paths) when archives change outside the hook (answers arrived). */
export const ARCHIVE_CHANGED = "codewart-archive-changed";

export function loadArchive(worktree: string): ReviewSession[] {
  try {
    const v = localStorage.getItem(ARCHIVE_PREFIX + worktree);
    return v ? (JSON.parse(v) as ReviewSession[]) : [];
  } catch {
    return [];
  }
}

export function saveArchive(worktree: string, list: ReviewSession[]) {
  try {
    localStorage.setItem(ARCHIVE_PREFIX + worktree, JSON.stringify(list));
  } catch {
    /* storage unavailable or full */
  }
}

/** Every worktree that has an archive. */
export function archivedWorktrees(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(ARCHIVE_PREFIX)) out.push(k.slice(ARCHIVE_PREFIX.length));
    }
  } catch {
    /* storage unavailable */
  }
  return out;
}

export function useReviewArchive(worktree: string) {
  const [list, setList] = useState<ReviewSession[]>(() => loadArchive(worktree));
  useEffect(() => {
    const on = (e: Event) => {
      const changed = (e as CustomEvent<string[]>).detail;
      if (changed.includes(worktree)) setList(loadArchive(worktree));
    };
    window.addEventListener(ARCHIVE_CHANGED, on);
    return () => window.removeEventListener(ARCHIVE_CHANGED, on);
  }, [worktree]);
  const add = useCallback(
    (s: Omit<ReviewSession, "n">) => {
      // Re-read so two tabs on the same worktree never reuse a number.
      const current = loadArchive(worktree);
      const entry: ReviewSession = { ...s, n: (current[0]?.n ?? 0) + 1 };
      const next = [entry, ...current].slice(0, MAX);
      saveArchive(worktree, next);
      setList(next);
      return entry;
    },
    [worktree],
  );
  return { list, add };
}

/** "Nov 8, 9:09 PM", with the year only when it isn't this year. */
export function formatWhen(ms: number): string {
  const d = new Date(ms);
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(thisYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}
