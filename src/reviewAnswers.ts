import { ARCHIVE_CHANGED, archivedWorktrees, loadArchive, saveArchive } from "./reviewArchive";
import type { CommentAnswer } from "./types";

/** One parsed answer: comment number (0 = the overall notes) → status and text. */
export type ParsedAnswers = Map<number, Omit<CommentAnswer, "at">>;

const SOLVED = /^(solved|fixed|done|addressed|resolved|changed)\b/i;
const ANSWERED = /^(answered|answer|reply|replied|declined|won'?t ?fix|kept|question|not changed|no change)\b/i;

/**
 * Parse what the agent piped into `wart answer`: one entry per comment,
 * `1. solved: …` / `2) answered — …` / `#3 fixed …`, continuation lines
 * belong to the entry above. Text before the first number is returned as `rest`.
 */
export function parseAnswers(text: string): { answers: ParsedAnswers; rest: string } {
  const answers: ParsedAnswers = new Map();
  const rest: string[] = [];
  let cur: { n: number; lines: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    let body = cur.lines.join("\n").trim();
    let status: CommentAnswer["status"] = "answered";
    const m = body.match(SOLVED) ?? body.match(ANSWERED);
    if (m) {
      status = SOLVED.test(m[0]) ? "solved" : "answered";
      body = body.slice(m[0].length).replace(/^\s*[:\-–—)\]]\s*/, "").trim();
    }
    if (body || m) answers.set(cur.n, { status, text: body });
    cur = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:[-*]\s*)?(?:#(\d{1,4})[.):\]]?|(\d{1,4})[.):\]])(?=\s|$)\s*(.*)$/);
    if (m) {
      flush();
      cur = { n: Number(m[1] ?? m[2]), lines: [m[3].replace(/^\*\*(.+?)\*\*/, "$1")] };
    } else if (cur) cur.lines.push(raw.trim());
    else if (raw.trim()) rest.push(raw.trim());
  }
  flush();
  return { answers, rest: rest.join("\n") };
}

/** Copied reviews not archived yet, by review id: archiving them first lets their answers land. */
const copied = new Map<string, () => void>();
export function registerCopied(id: string, archive: () => void): () => void {
  copied.set(id, archive);
  return () => {
    if (copied.get(id) === archive) copied.delete(id);
  };
}

/**
 * Attach the agent's answers to every archived review session with this id
 * (a review sent from several repos is archived once per repo). Returns how
 * many comments got an answer, or null if no review has this id.
 */
export function applyAnswers(reviewId: string, text: string): { answered: number; rounds: number[] } | null {
  const pending = copied.get(reviewId);
  if (pending) {
    copied.delete(reviewId);
    pending();
  }
  const { answers, rest } = parseAnswers(text);
  const at = Date.now();
  const changed: string[] = [];
  const rounds: number[] = [];
  let answered = 0;
  let found = false;
  for (const wt of archivedWorktrees()) {
    const list = loadArchive(wt);
    let touched = false;
    const next = list.map((s) => {
      if (s.id !== reviewId) return s;
      found = touched = true;
      rounds.push(s.n);
      const got = { ...(s.answers ?? {}) };
      for (const c of s.comments) {
        const a = c.num != null ? answers.get(c.num) : undefined;
        if (a) {
          got[c.id] = { ...a, at };
          answered++;
        }
      }
      const notes = [answers.get(0)?.text, rest].filter(Boolean).join("\n\n");
      return { ...s, answers: got, reply: notes || s.reply };
    });
    if (touched) {
      saveArchive(wt, next);
      changed.push(wt);
    }
  }
  if (!found) return null;
  window.dispatchEvent(new CustomEvent(ARCHIVE_CHANGED, { detail: changed }));
  return { answered, rounds };
}
