import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api, errorMessage } from "../api";
import { formatWhen } from "../reviewArchive";
import { registerCopied } from "../reviewAnswers";
import { hasContent, publish, unpublish, useScopePeers, type BoardEntry } from "../reviewBoard";
import type { AgentSession, PendingReview, ReviewComment, ReviewSession } from "../types";
import { answerFooter, newReviewId, numbered, relativeTime, reviewMarkdown } from "../util";
import { ChevronDown, Copy, Send } from "./Icons";
import { Popover, useAnchored } from "./Popover";

interface Props {
  worktree: string;
  /** Repository name (heads its section in a review shared by several repos). */
  repoName: string;
  /** Stable id of this tab. */
  tabId: string;
  /** Tabs sharing a scope are reviewed and sent together (same branch, or one folder request). */
  scope: string;
  /** What the scope is called in a shared review's heading (branch or folder). */
  scopeName: string;
  target: string;
  comments: ReviewComment[];
  onRemove: (id: string) => void;
  onJump: (c: ReviewComment) => void;
  /** Bring this tab to the front (a comment of it was clicked in another tab). */
  onFocusTab: () => void;
  onClear: () => void;
  note: string;
  onNote: (s: string) => void;
  toast: (msg: string, err?: boolean) => void;
  /** Bumps whenever the worktree changes on disk (the agent produced a new version). */
  diskVersion: number;
  /** Past review sessions of this worktree, newest first. */
  sessions: ReviewSession[];
  /** Archive a handed-over review and clear what it contained. */
  onArchive: BoardEntry["archive"];
  /** An agent ran `wart review` and is waiting for this review. */
  request?: PendingReview;
  /** The request with this reply file was answered. */
  onRequestDone: (reply: string) => void;
}

/** What the waiting agent receives when there is nothing to change. */
const APPROVED = "APPROVED: the reviewer looked at the changes and has no further feedback.";
const DISMISSED = "DISMISSED: the reviewer declined to review right now. Continue without review feedback.";

/** The review exactly as it was handed to the agent. */
export interface ReviewSnapshot {
  target: string;
  comments: ReviewComment[];
  note: string;
  markdown: string;
  id: string;
}

/** One repo's part of what is sent. */
interface Part {
  repo: string;
  target: string;
  comments: ReviewComment[];
  note: string;
  archive: BoardEntry["archive"];
  /** This tab's own review. */
  mine?: true;
}

/** Every repo's review in one prompt, comments numbered straight through, ending with how to answer. */
function compose(parts: Part[], shared: boolean, scopeName: string, id: string, includeCode: boolean) {
  let start = 1;
  const sections = parts.map((p) => {
    const md = reviewMarkdown({ ...p, includeCode, start });
    const comments = numbered(p.comments, start);
    start += p.comments.length;
    return { part: p, md, comments };
  });
  const body = shared
    ? `# Review of ${scopeName} (${sections.length} repositor${sections.length === 1 ? "y" : "ies"})\n\n` +
      sections.map((s) => `## ${s.part.repo}\n\n${s.md.trimEnd()}`).join("\n\n")
    : sections[0]?.md ?? "";
  const markdown = sections.length ? `${body.trimEnd()}\n\n${answerFooter(id, start - 1)}` : "";
  return { markdown, sections };
}

export function ReviewPane({
  worktree,
  repoName,
  tabId,
  scope,
  scopeName,
  target,
  comments,
  onRemove,
  onJump,
  onFocusTab,
  onClear,
  note,
  onNote,
  toast,
  diskVersion,
  sessions: past,
  onArchive,
  request: ownRequest,
  onRequestDone,
}: Props) {
  const [includeCode, setIncludeCode] = useState(true);
  const [preview, setPreview] = useState(false);
  const [submit, setSubmit] = useState(true);
  const [sessions, setSessions] = useState<AgentSession[] | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Id of the review being written; a new one after each hand-over. */
  const [rid, setRid] = useState(newReviewId);
  // Hovering Copy / Send shows what will be sent. Small delays avoid flicker and
  // let the pointer travel into the preview to scroll it.
  const [previewOpen, setPreviewOpen] = useState(false);
  const peekTimer = useRef<number | undefined>(undefined);
  const sendRow = useRef<HTMLDivElement>(null);
  const showPreview = (on: boolean) => {
    window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => setPreviewOpen(on), on ? 250 : 180);
  };
  useEffect(() => () => window.clearTimeout(peekTimer.current), []);

  // ---- this tab on the board, the other repos in the same scope ----------------
  const live = useRef({ onRemove, onJump, onFocusTab, onArchive });
  live.current = { onRemove, onJump, onFocusTab, onArchive };
  useEffect(() => {
    publish({
      tabId,
      scope,
      repo: repoName,
      target,
      comments,
      note,
      request: ownRequest,
      remove: (id) => live.current.onRemove(id),
      focus: () => live.current.onFocusTab(),
      jump: (c) => {
        live.current.onFocusTab();
        live.current.onJump(c);
      },
      archive: (snap, via, sentTo) => live.current.onArchive(snap, via, sentTo),
    });
  }, [tabId, scope, repoName, target, comments, note, ownRequest]);
  useEffect(() => () => unpublish(tabId), [tabId]);
  const peers = useScopePeers(scope, tabId);
  const others = useMemo(() => peers.filter(hasContent), [peers]);
  /** A request waiting anywhere in the scope is answered from any of its tabs. */
  const request = ownRequest ?? peers.find((p) => p.request)?.request;
  const shared = others.length > 0;

  const mine: Part = { repo: repoName, target, comments, note, archive: onArchive, mine: true };
  const parts: Part[] = [...(hasContent(mine) ? [mine] : []), ...others];
  const { markdown, sections } = useMemo(
    () => compose(parts, shared, scopeName, rid, includeCode),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comments, note, target, others, shared, scopeName, rid, includeCode, repoName],
  );
  const empty = parts.length === 0;

  /** Archive every repo's part of what was just handed over, as review `rid`. */
  const archiveAll = (secs: typeof sections, md: string, via: "session" | "copy", sentTo?: string) => {
    let mineRound: ReviewSession | null = null;
    for (const s of secs) {
      const r = s.part.archive({ target: s.part.target, comments: s.comments, note: s.part.note, markdown: md, id: rid }, via, sentTo);
      if (s.part.mine) mineRound = r;
    }
    setRid(newReviewId());
    return mineRound;
  };
  const alsoRepos = (secs: typeof sections) => {
    const n = secs.filter((s) => !s.part.mine).length;
    return n ? ` · with ${n} more repo${n === 1 ? "" : "s"}` : "";
  };

  // A copied review waits for the agent's next version, then asks to be archived.
  const [pending, setPending] = useState<{ ids: string[]; note: string; version: number; archive: () => void } | null>(null);
  const [openSession, setOpenSession] = useState<number | null>(null);
  useEffect(() => {
    if (!pending) return;
    return registerCopied(rid, pending.archive);
  }, [pending, rid]);

  const copyText = async (text: string, msg: string) => {
    try {
      await writeText(text);
    } catch (e) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        toast(errorMessage(e), true);
        return false;
      }
    }
    toast(msg);
    return true;
  };

  const copy = async () => {
    const secs = sections, md = markdown;
    if (!(await copyText(md, "Review copied as markdown"))) return;
    setPending({
      ids: comments.map((c) => c.id),
      note,
      version: diskVersion,
      archive: () => {
        setPending(null);
        archiveAll(secs, md, "copy");
      },
    });
  };

  // Ask only while the copied review is still here (not cleared or already archived).
  const stillHere =
    !!pending &&
    (pending.ids.some((id) => comments.some((x) => x.id === id)) || (!!pending.note.trim() && note.trim() === pending.note.trim()));
  const askArchive = !!pending && diskVersion > pending.version && stillHere;
  const nextNumber = (past[0]?.n ?? 0) + 1;

  const archiveCopied = () => {
    if (!pending) return;
    pending.archive();
    toast(`Archived as review #${nextNumber} · new review started`);
  };

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await api.listSessions(worktree));
    } catch (e) {
      setSessions([]);
      toast(errorMessage(e), true);
    }
  }, [worktree, toast]);

  /** Answer a `wart review` request: the waiting agent prints this and continues. */
  const reply = async (verdict?: string) => {
    if (!request) return;
    setBusy(true);
    try {
      const secs = sections, md = markdown;
      const text = verdict ?? (empty ? APPROVED : md.trimEnd());
      await api.writeReviewReply(request.reply, text);
      onRequestDone(request.reply);
      setPending(null);
      if (text === md.trimEnd()) {
        const r = archiveAll(secs, md, "session", "agent (wart review)");
        toast(`Review sent to the agent${r ? ` · archived as review #${r.n}` : ""}${alsoRepos(secs)}`);
      } else toast(text === APPROVED ? "Approved: the agent continues" : "Review request dismissed");
    } catch (e) {
      toast(errorMessage(e), true);
    } finally {
      setBusy(false);
    }
  };

  const send = async (s: AgentSession) => {
    setPickOpen(false);
    setBusy(true);
    try {
      const secs = sections, md = markdown;
      await api.injectText(s.id, md.trimEnd(), submit);
      setPending(null);
      const r = archiveAll(secs, md, "session", s.label);
      toast(`Sent to ${s.label}${r ? ` · archived as review #${r.n}` : ""}${alsoRepos(secs)}`);
    } catch (e) {
      toast(errorMessage(e), true);
    } finally {
      setBusy(false);
    }
  };

  const peekStyle = useAnchored(() => sendRow.current, previewOpen && !pickOpen && !empty, "right", true, 8);
  const commentItem = (c: ReviewComment, repo: string | null, remove: (id: string) => void, jump: (c: ReviewComment) => void) => (
    <div key={`${repo ?? ""}:${c.id}`} className={`citem${repo && repo !== repoName ? " other" : ""}`} onClick={() => jump(c)}>
      <span className="loc">
        {repo && <span className="repotag">{repo}</span>}
        {c.symbol ? `${c.symbol} · ` : ""}
        {c.file}
        {c.line > 0 ? `:${c.line}` : " · whole file"}
      </span>
      <button
        className="rm"
        aria-label="Remove comment"
        onClick={(e) => {
          e.stopPropagation();
          remove(c.id);
        }}
      >
        ×
      </button>
      <span className="txt">{c.body}</span>
    </div>
  );
  const total = comments.length + others.reduce((n, o) => n + o.comments.length, 0);

  return (
    <section className="pane fl review" aria-label="Review">
      <div className="panehead">
        <div className="rhead">
          <h2 className="h2">Review</h2>
          {comments.length > 0 && (
            <button
              className="linkbtn"
              onClick={onClear}
              title={`Remove ${comments.length} comment${comments.length === 1 ? "" : "s"} of ${repoName} and the notes`}
            >
              clear {comments.length}
            </button>
          )}
        </div>
        <div className="seg">
          <button className={!preview ? "on" : ""} onClick={() => setPreview(false)}>
            write
          </button>
          <button className={preview ? "on" : ""} onClick={() => setPreview(true)}>
            markdown
          </button>
        </div>
      </div>
      {/* Scrolls as a whole when the pane is short; the send row stays put. */}
      <div className="rbody">
        {request && (
          <div className="rrequest" role="status">
            <div className="r1">
              <span className="waitdot" />
              <b>The agent is waiting for your review</b>
              <span className="faint">{relativeTime(request.at / 1000)}</span>
            </div>
            {request.message && <p className="msg">{request.message}</p>}
            {request.group && (
              <p className="msg">
                For all {request.group.repos} repos in {request.group.name}: sending from any of them includes the comments of every repo.
              </p>
            )}
            {!ownRequest && <p className="msg">Requested from another repo on this branch: sending from here answers it, with every repo's comments.</p>}
            <div className="row">
              <button className="linkbtn" disabled={busy} onClick={() => void reply(APPROVED)} title="Tell the agent there is nothing to change">
                approve, no changes
              </button>
              <button className="linkbtn" disabled={busy} onClick={() => void reply(DISMISSED)} title="Release the agent without a review">
                dismiss
              </button>
            </div>
          </div>
        )}
        {total > 0 && !preview && (
          <div className="clist">
            {shared && (
              <div className="cscope">
                {total} comment{total === 1 ? "" : "s"} in {parts.length} repo{parts.length === 1 ? "" : "s"} · all are sent together
              </div>
            )}
            {comments.map((c) => commentItem(c, shared ? repoName : null, onRemove, onJump))}
            {others.map((o) => [
              ...o.comments.map((c) => commentItem(c, o.repo, o.remove, o.jump)),
              ...(o.note.trim()
                ? [
                    <div key={`${o.tabId}:note`} className="citem other" onClick={o.focus}>
                      <span className="loc">
                        <span className="repotag">{o.repo}</span>notes
                      </span>
                      <span className="txt">{o.note.trim()}</span>
                    </div>,
                  ]
                : []),
            ])}
          </div>
        )}
        <div className="mdwrap">
          {preview ? (
            <pre>{markdown}</pre>
          ) : (
            <textarea
              value={note}
              onChange={(e) => onNote(e.target.value)}
              placeholder={
                comments.length
                  ? "Overall notes for the agent (markdown)…"
                  : "Write feedback in markdown, or click a line number in the diff to comment on code."
              }
              aria-label="Review notes"
            />
          )}
        </div>
        {askArchive && (
          <div className="rprompt" role="alert">
            <p>
              The agent made changes since you copied this review. Treat them as the new version and archive this as{" "}
              <b>review #{nextNumber}</b>?
            </p>
            <div className="row">
              <button className="btn sm pri" onClick={archiveCopied}>
                Archive &amp; start new review
              </button>
              <button className="btn sm" onClick={() => setPending(null)}>
                Not now
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="rfoot">
        <div className="row">
          <label className="chk">
            <input type="checkbox" checked={includeCode} onChange={(e) => setIncludeCode(e.target.checked)} />
            include code
          </label>
          <label className="chk">
            <input type="checkbox" checked={submit} onChange={(e) => setSubmit(e.target.checked)} />
            press Enter after send
          </label>
        </div>
        <div
          ref={sendRow}
          className="row sendrow"
          onMouseEnter={() => showPreview(true)}
          onMouseLeave={() => showPreview(false)}
          onFocus={() => showPreview(true)}
          onBlur={() => showPreview(false)}
        >
          {previewOpen &&
            !pickOpen &&
            !empty &&
            peekStyle &&
            createPortal(
              <div
                className="promptpeek"
                role="tooltip"
                aria-label="Prompt preview"
                style={peekStyle}
                onMouseEnter={() => showPreview(true)}
                onMouseLeave={() => showPreview(false)}
              >
                <div className="cap">
                  Prompt preview <span className="faint">· {markdown.length.toLocaleString()} chars</span>
                </div>
                <pre>{markdown.trimEnd()}</pre>
              </div>,
              document.body,
            )}
          <button className="btn" onClick={copy} disabled={empty}>
            <Copy size={14} /> Copy
          </button>
          {request ? (
            <button className="btn pri" style={{ flex: 1 }} disabled={busy} onClick={() => void reply()}>
              <Send size={14} /> {empty ? "Approve" : "Send to agent"}
            </button>
          ) : (
            <div style={{ position: "relative", flex: 1 }}>
              <button
                className="btn pri"
                style={{ width: "100%" }}
                disabled={empty || busy}
                onClick={() => {
                  setPickOpen((o) => !o);
                  void loadSessions();
                }}
              >
                <Send size={14} /> Send to session <ChevronDown />
              </button>
              <Popover open={pickOpen} onClose={() => setPickOpen(false)} align="right" up>
                <div className="cap">Agent sessions in this worktree</div>
                {sessions === null && <div className="m" style={{ padding: "8px 12px" }}>Scanning…</div>}
                {sessions?.length === 0 && (
                  <div className="m" style={{ padding: "8px 12px", whiteSpace: "normal", lineHeight: 1.5 }}>
                    No tmux, WezTerm or kitty pane is running in this worktree. Use Copy and paste into your agent instead.
                  </div>
                )}
                {sessions?.map((s) => (
                  <button key={s.id} className="opt" onClick={() => send(s)}>
                    <span className="r1">
                      {s.command || "shell"}
                      {s.isAgent && <span className="badge added">agent</span>}
                    </span>
                    <span className="m">{s.label}</span>
                  </button>
                ))}
              </Popover>
            </div>
          )}
        </div>
      </div>
      {past.length > 0 && (
        <div className="rhist" aria-label="Past reviews">
          <div className="cap">Past reviews</div>
          {past.map((r) => {
            const open = openSession === r.n;
            const count = r.comments.length;
            const answered = r.comments.filter((c) => r.answers?.[c.id]).length;
            return (
              <div key={r.n} className={`rh${open ? " open" : ""}`}>
                <button className="rh-row" onClick={() => setOpenSession(open ? null : r.n)} aria-expanded={open}>
                  <b>#{r.n}</b>
                  <span>{formatWhen(r.at)}</span>
                  <span className="grow" />
                  {answered > 0 && (
                    <span className={`ansn${answered === count ? " all" : ""}`} title={`The agent answered ${answered} of ${count}`}>
                      {answered}/{count} answered
                    </span>
                  )}
                  <span className="faint" title={`${count} comment${count === 1 ? "" : "s"}`}>
                    {count} · {r.via === "session" ? "sent" : "copied"}
                  </span>
                </button>
                {open && (
                  <div className="rh-body">
                    <div className="m">
                      {r.target}
                      {r.sentTo ? ` · sent to ${r.sentTo}` : " · copied & pasted"}
                      {r.id ? ` · id ${r.id}` : ""}
                    </div>
                    {(r.answers || r.reply) && (
                      <div className="rh-answers">
                        {r.reply && (
                          <div className="rh-ans">
                            <span className="st answered">agent</span>
                            <span className="txt">{r.reply}</span>
                          </div>
                        )}
                        {r.comments.map((c) => {
                          const a = r.answers?.[c.id];
                          return (
                            <div key={c.id} className="rh-ans" onClick={() => onJump(c)}>
                              <span className={`st ${a?.status ?? "open"}`}>{a ? a.status : "no answer"}</span>
                              <span className="loc">
                                {c.num != null ? `${c.num}. ` : ""}
                                {c.file}
                                {c.line > 0 ? `:${c.line}` : ""}
                              </span>
                              <span className="was">{c.body}</span>
                              {a?.text && <span className="txt">{a.text}</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <pre>{r.markdown.trimEnd()}</pre>
                    <button className="linkbtn" onClick={() => void copyText(r.markdown, `Review #${r.n} copied`)}>
                      copy again
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
