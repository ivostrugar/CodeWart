import { memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { gapSize, gapsOf, rowsWithContext, unfoldGap, type Unfold } from "../expand";
import type { CommitBadge, FileDiff, Ghost, ReviewComment } from "../types";
import { TAG_LABEL, isFileComment, splitPath } from "../util";
import { CodeLines, FileComments, GhostCards, GhostMark, type Row } from "./CodeLines";
import { ChevronDown, ChevronRight, Code, Comment } from "./Icons";

export interface ScrollTarget {
  path: string;
  line?: number;
  side?: "new" | "old";
  nonce: number;
}

interface Props {
  files: FileDiff[];
  comments: ReviewComment[];
  /** Comments from earlier review rounds, with the agent's answers. */
  ghosts?: Ghost[];
  onAddComment: (c: ReviewComment) => void;
  onRemoveComment: (id: string) => void;
  onUpdateComment: (id: string, body: string) => void;
  target: ScrollTarget | null;
  onActiveFile: (path: string) => void;
  onOpenInEditor: (path: string, line?: number) => void;
  sendLabel: string;
  /** Receives the scroll container (for back navigation). */
  scrollRef?: MutableRefObject<HTMLDivElement | null>;
  /** Full text of a file on the diff's new side (to unfold unchanged lines). */
  loadFile: (path: string) => Promise<string | null>;
  /** Commits named on changed lines (multi-commit selections). */
  commits?: Map<string, CommitBadge> | null;
  onCommit?: (sha: string, action: "only" | "hide" | "show") => void;
}

const NO_COMMENTS: ReviewComment[] = [];
const NO_GHOSTS: Ghost[] = [];

export function DiffView({ files, comments, ghosts, onAddComment, onRemoveComment, onUpdateComment, target, onActiveFile, onOpenInEditor, sendLabel, scrollRef, loadFile, commits, onCommit }: Props) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);

  // Scroll to a requested file / line.
  useEffect(() => {
    if (!target || !scroller.current) return;
    setCollapsed((c) => {
      if (!c.has(target.path)) return c;
      const n = new Set(c);
      n.delete(target.path);
      return n;
    });
    requestAnimationFrame(() => {
      const root = scroller.current;
      if (!root) return;
      const fileEl = root.querySelector<HTMLElement>(`[data-file="${CSS.escape(target.path)}"]`);
      if (!fileEl) return;
      let el: HTMLElement | null = fileEl;
      if (target.line != null) {
        const side = target.side ?? "new";
        el =
          fileEl.querySelector<HTMLElement>(`[data-l="${side}:${target.line}"]`) ??
          // Nearest following line if the exact one is outside the hunks.
          Array.from(fileEl.querySelectorAll<HTMLElement>(`[data-l^="${side}:"]`)).find(
            (e) => Number(e.dataset.l!.split(":")[1]) >= target.line!,
          ) ??
          fileEl;
        setFlash(`${target.path}|${side}:${target.line}`);
      }
      const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
      root.scrollTo({ top: Math.max(0, top - (el === fileEl ? 0 : 120)), behavior: "smooth" });
    });
  }, [target]);

  // Track which file is at the top of the viewport.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const top = root.getBoundingClientRect().top + 60;
        let current: string | null = null;
        for (const el of root.querySelectorAll<HTMLElement>("[data-file]")) {
          if (el.getBoundingClientRect().top <= top) current = el.dataset.file!;
          else break;
        }
        if (current) onActiveFile(current);
      });
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [onActiveFile]);

  const byFile = useMemo(() => {
    const m = new Map<string, ReviewComment[]>();
    for (const c of comments) {
      const l = m.get(c.file) ?? [];
      l.push(c);
      m.set(c.file, l);
    }
    return m;
  }, [comments]);
  const ghostsByFile = useMemo(() => {
    const m = new Map<string, Ghost[]>();
    for (const g of ghosts ?? []) m.set(g.comment.file, [...(m.get(g.comment.file) ?? []), g]);
    return m;
  }, [ghosts]);

  if (files.length === 0) {
    return (
      <div className="empty">
        <div className="big">Nothing to review</div>
        No changes in this selection, or every changed file is hidden by the active filters.
      </div>
    );
  }

  return (
    <div
      className="diffscroll"
      ref={(el) => {
        scroller.current = el;
        if (scrollRef) scrollRef.current = el;
      }}
    >
      {files.map((f) => (
        <FileBlock
          key={f.path}
          file={f}
          collapsed={collapsed.has(f.path)}
          onToggle={() =>
            setCollapsed((c) => {
              const n = new Set(c);
              n.has(f.path) ? n.delete(f.path) : n.add(f.path);
              return n;
            })
          }
          comments={byFile.get(f.path) ?? NO_COMMENTS}
          ghosts={ghostsByFile.get(f.path) ?? NO_GHOSTS}
          flash={flash?.startsWith(f.path + "|") ? flash.slice(f.path.length + 1) : null}
          onAddComment={onAddComment}
          onRemoveComment={onRemoveComment}
          onUpdateComment={onUpdateComment}
          onOpenInEditor={onOpenInEditor}
          sendLabel={sendLabel}
          loadFile={loadFile}
          commits={commits}
          onCommit={onCommit}
        />
      ))}
    </div>
  );
}

interface BlockProps {
  file: FileDiff;
  collapsed: boolean;
  onToggle: () => void;
  comments: ReviewComment[];
  ghosts: Ghost[];
  flash: string | null;
  onAddComment: (c: ReviewComment) => void;
  onRemoveComment: (id: string) => void;
  onUpdateComment: (id: string, body: string) => void;
  onOpenInEditor: (path: string, line?: number) => void;
  sendLabel: string;
  loadFile: (path: string) => Promise<string | null>;
  commits?: Map<string, CommitBadge> | null;
  onCommit?: (sha: string, action: "only" | "hide" | "show") => void;
}

const FileBlock = memo(function FileBlock({
  file,
  collapsed,
  onToggle,
  comments,
  ghosts,
  flash,
  onAddComment,
  onRemoveComment,
  onUpdateComment,
  onOpenInEditor,
  sendLabel,
  loadFile,
  commits,
  onCommit,
}: BlockProps) {
  const { dir, name } = splitPath(file.path);
  // Unfolded unchanged lines, GitHub-style. Reset when the diff itself changes.
  const [unfold, setUnfold] = useState<Map<number, Unfold>>(() => new Map());
  const [text, setText] = useState<string[] | null>(null);
  // Diffs reload whenever the agent touches the worktree; only a real change to
  // this file's hunks folds everything back.
  const shape = file.hunks.map((h) => `${h.oldStart},${h.oldLines},${h.newStart},${h.newLines}`).join(" ");
  useEffect(() => {
    setUnfold(new Map());
    setText(null);
  }, [shape]);
  const rows = useMemo<Row[]>(() => rowsWithContext(file.hunks, unfold, text), [file.hunks, unfold, text]);
  const expandable = !file.binary && file.status !== "added" && file.status !== "deleted" && file.hunks.length > 0;
  const onExpand = useCallback(
    async (gap: number, dir: "up" | "down" | "all") => {
      let lines = text;
      if (!lines) {
        const t = await loadFile(file.path);
        if (t == null) return;
        lines = t.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
        setText(lines);
      }
      const size = gapSize(gapsOf(file.hunks)[gap], lines.length);
      setUnfold((m) => new Map(m).set(gap, unfoldGap(m.get(gap), dir, size)));
    },
    [text, loadFile, file.path, file.hunks],
  );
  const firstChange = file.hunks.flatMap((h) => h.lines).find((l) => l.kind !== "ctx");
  const [composing, setComposing] = useState(false);
  const [fileComments, lineComments] = useMemo(
    () => [comments.filter(isFileComment), comments.filter((c) => !isFileComment(c))],
    [comments],
  );
  const [fileGhosts, lineGhosts] = useMemo(() => [ghosts.filter((g) => g.comment.line === 0), ghosts.filter((g) => g.comment.line !== 0)], [ghosts]);
  const [fileGhostsOpen, setFileGhostsOpen] = useState(false);

  return (
    <section className="dfile" data-file={file.path}>
      <div className="dfile-head">
        <button className="chev" onClick={onToggle} aria-label={collapsed ? "Expand file" : "Collapse file"}>
          {collapsed ? <ChevronRight /> : <ChevronDown />}
        </button>
        <h3 title={file.path}>
          {file.oldPath && file.oldPath !== file.path && <span className="dir">{file.oldPath} → </span>}
          <span className="dir">{dir}</span>
          {name}
        </h3>
        <button
          className={`iconbtn filecomment${fileComments.length ? " has" : ""}`}
          style={{ width: 26, height: 26 }}
          aria-label="Comment on this file"
          data-tip={fileComments.length ? `Comment on file (${fileComments.length} in batch)` : "Comment on file"}
          data-tip-left
          onClick={() => setComposing(true)}
        >
          <Comment size={14} />
        </button>
        {fileGhosts.length > 0 && <GhostMark ghosts={fileGhosts} open={fileGhostsOpen} onToggle={() => setFileGhostsOpen((o) => !o)} />}
        <span className="m" style={{ flex: "none" }}>
          {file.additions > 0 && <span className="add-c">+{file.additions}</span>} {file.deletions > 0 && <span className="del-c">−{file.deletions}</span>}
        </span>
        {file.status !== "modified" && <span className={`badge ${file.status}`}>{file.status}</span>}
        {file.tags.map((t) => (
          <span key={t} className="badge">
            {TAG_LABEL[t]}
          </span>
        ))}
        <span className="grow" />
        {file.status !== "deleted" && (
          <button
            className="iconbtn"
            style={{ width: 28, height: 28 }}
            aria-label="Open file in editor"
            data-tip="Open in editor"
            onClick={() => onOpenInEditor(file.path, firstChange?.new ?? undefined)}
          >
            <Code size={14} />
          </button>
        )}
      </div>
      {fileGhostsOpen && fileGhosts.length > 0 && (
        <div className="filecomments">
          <GhostCards ghosts={fileGhosts} onClose={() => setFileGhostsOpen(false)} />
        </div>
      )}
      <FileComments
        path={file.path}
        side={file.status === "deleted" ? "old" : "new"}
        comments={fileComments}
        composing={composing}
        onCloseComposer={() => setComposing(false)}
        onAddComment={onAddComment}
        onRemoveComment={onRemoveComment}
        onUpdateComment={onUpdateComment}
        sendLabel={sendLabel}
      />
      {!collapsed && (
        <>
          {file.binary && <div className="dnote">Binary file not shown.</div>}
          {!file.binary && file.hunks.length === 0 && (
            <div className="dnote">
              {file.status === "renamed" ? "Renamed without content changes." : file.truncated ? "File too large to display." : "No content changes."}
            </div>
          )}
          {rows.length > 0 && (
            <div className="dcode">
            <CodeLines
              path={file.path}
              rows={rows}
              comments={lineComments}
              ghosts={lineGhosts}
              onAddComment={onAddComment}
              onRemoveComment={onRemoveComment}
              onUpdateComment={onUpdateComment}
              flash={flash}
              sendLabel={sendLabel}
              onExpand={expandable ? onExpand : undefined}
              commits={commits}
              onCommit={onCommit}
            />
            </div>
          )}
          {file.truncated && file.hunks.length > 0 && <div className="dnote">Diff truncated — open the file to see the rest.</div>}
        </>
      )}
    </section>
  );
});
