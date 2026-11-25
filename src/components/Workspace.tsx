import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "../api";
import type {
  Attribution,
  CallGraph,
  CommitBadge,
  DiffResult,
  Editor,
  FileDiff,
  FileTag,
  Filters,
  Ghost,
  GraphNode,
  GraphScope,
  History,
  HistoryMode,
  PendingReview,
  Peer,
  Project,
  ReviewComment,
  Selection,
  View,
} from "../types";
import { hiddenReason, newId, tildify } from "../util";
import { TONES, attributeFiles } from "../commits";
import { FindBar } from "./FindBar";
import { CallGraphView } from "./CallGraphView";
import { DiffView, type ScrollTarget } from "./DiffView";
import { FilesPane } from "./FilesPane";
import { FilterBar } from "./FilterBar";
import { HistoryPane, WORKING, historyKeys } from "./HistoryPane";
import { ReviewPane, type ReviewSnapshot } from "./ReviewPane";
import { useReviewArchive } from "../reviewArchive";
import { Splitter, toggleLeftPane } from "./Splitter";
import { WorktreeBar } from "./WorktreeBar";

interface Props {
  project: Project;
  worktree: string;
  active: boolean;
  filters: Filters;
  onFilters: (f: Filters) => void;
  editor: Editor | null;
  /** Stable callbacks (keyed by project id) so inactive workspaces don't re-render. */
  onWorktree: (projectId: string, path: string) => void;
  onRescan: (projectId: string) => void;
  /** The worktree changed on disk (quietly re-reads branches / last-update times). */
  onActivity: (projectId: string) => void;
  /** Shared across all open repos, so switching repos keeps the view. */
  view: View;
  onView: (v: View) => void;
  scope: GraphScope;
  onScope: (s: GraphScope) => void;
  /** Other repos opened from the same folder. */
  peers: Peer[];
  groupName?: string;
  /** Stable id of this tab (for review requests). */
  tabId: string;
  /** An agent is waiting for a review of this worktree (`wart review`). */
  reviewRequest?: PendingReview;
  /** The request with this reply file was answered. */
  onReviewDone: (reply: string) => void;
  /** Tabs with the same scope share one review (repos on one branch / one folder request). */
  reviewScope: string;
  /** Previous tab, for Back when this tab has no history of its own. */
  backTo?: { id: string; name: string } | null;
  onBackTo: (tabId: string) => void;
  onJumpToPeer: (projectId: string, worktree?: string) => void;
  toast: (msg: string, err?: boolean) => void;
}

const POLL_MS = 1500;
/** How many past review rounds leave ghost comments in the diff. */
const GHOST_ROUNDS = 5;
const MAX_BACK = 50;

/** What "back" restores. */
interface NavState {
  view: View;
  mode: HistoryMode;
  pick: { a: string; b: string } | null;
  follow: boolean;
  graphSel: string | null;
  diffScroll: number;
}

/** Show `on` only after it has been true for `ms` (avoids spinner flicker). */
function useDelayed(on: boolean, ms: number) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!on) {
      setShown(false);
      return;
    }
    const t = window.setTimeout(() => setShown(true), ms);
    return () => window.clearTimeout(t);
  }, [on, ms]);
  return shown;
}

function Overlay({ label, wide }: { label: string; wide?: boolean }) {
  return (
    <div className={`overlay${wide ? " stage-wide" : ""}`} role="status" aria-live="polite">
      <div className="box">
        <div className="spinner" />
        {label}
      </div>
    </div>
  );
}

export const Workspace = memo(function Workspace({
  project,
  worktree,
  active,
  filters,
  onFilters,
  editor,
  onWorktree,
  onRescan,
  onActivity,
  view,
  onView,
  scope,
  onScope,
  peers,
  groupName,
  tabId,
  reviewRequest,
  onReviewDone,
  reviewScope,
  backTo,
  onBackTo,
  onJumpToPeer,
  toast,
}: Props) {
  const [history, setHistory] = useState<History | null>(null);
  const [mode, setMode] = useState<HistoryMode>("single");
  const [pick, setPick] = useState<{ a: string; b: string } | null>(null);
  const [follow, setFollow] = useState(true);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [graph, setGraph] = useState<CallGraph | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [target, setTarget] = useState<ScrollTarget | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // bumps when the worktree changes on disk (or on refresh)
  const [diskVersion, setDiskVersion] = useState(0); // bumps only when the worktree changes on disk
  const [graphSel, setGraphSel] = useState<string | null>(null);
  const [attr, setAttr] = useState<{ key: string; data: Attribution } | null>(null);
  /** Commits whose changes are hidden from the diff (deselected in the history). */
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [findOpen, setFindOpen] = useState<{ q: string; n: number } | null>(null);
  const diffScroller = useRef<HTMLDivElement | null>(null);
  const centerRef = useRef<HTMLElement | null>(null);

  // ---- back navigation ---------------------------------------------------
  const navStack = useRef<NavState[]>([]);
  const [navDepth, setNavDepth] = useState(0);
  const pendingScroll = useRef<number | null>(null);
  const pushNav = () => {
    const snap: NavState = { view, mode, pick, follow, graphSel, diffScroll: diffScroller.current?.scrollTop ?? 0 };
    const st = navStack.current;
    const top = st[st.length - 1];
    if (
      top &&
      top.view === snap.view &&
      top.mode === snap.mode &&
      top.pick?.a === snap.pick?.a &&
      top.pick?.b === snap.pick?.b &&
      top.graphSel === snap.graphSel &&
      Math.abs(top.diffScroll - snap.diffScroll) < 40
    )
      return;
    st.push(snap);
    if (st.length > MAX_BACK) st.shift();
    setNavDepth(st.length);
  };
  const goBack = () => {
    const prev = navStack.current.pop();
    setNavDepth(navStack.current.length);
    if (!prev) return;
    onView(prev.view);
    setMode(prev.mode);
    setPick(prev.pick);
    setFollow(prev.follow);
    setGraphSel(prev.graphSel);
    pendingScroll.current = prev.diffScroll;
  };
  /** Back in this tab's history; with none left, back to the tab you came from. */
  const back = () => {
    if (navStack.current.length) goBack();
    else if (backTo) onBackTo(backTo.id);
  };
  // Restore the diff scroll position once the restored view has rendered.
  useEffect(() => {
    if (pendingScroll.current == null || view !== "diff") return;
    const top = pendingScroll.current;
    pendingScroll.current = null;
    requestAnimationFrame(() => diffScroller.current?.scrollTo({ top }));
  });

  const keys = useMemo(() => historyKeys(history), [history]);

  // ---- history -----------------------------------------------------------
  const followRef = useRef(follow);
  followRef.current = follow;
  useEffect(() => {
    let cancelled = false;
    api
      .history(worktree)
      .then((h) => {
        if (cancelled) return;
        setHistory(h);
        setError(null);
        const ks = historyKeys(h);
        setPick((p) => {
          const newest = ks[0];
          if (!newest) return null;
          if (!p || !ks.includes(p.a) || !ks.includes(p.b)) return { a: newest, b: newest };
          if (followRef.current && mode === "single") return { a: newest, b: newest };
          return p;
        });
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worktree, tick]);

  // ---- follow the agent: poll a cheap fingerprint ---------------------------
  // The last fingerprint survives tab switches, so work the agent did while
  // this project was in the background is picked up on return.
  const lastFp = useRef<string | null>(null);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const fp = await api.fingerprint(worktree);
        if (stopped) return;
        if (lastFp.current !== null && fp !== lastFp.current) {
          setTick((t) => t + 1);
          setDiskVersion((v) => v + 1);
          onActivity(project.id);
        }
        lastFp.current = fp;
      } catch {
        /* worktree may be mid-operation */
      }
    };
    void poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [active, worktree, onActivity, project.id]);

  // ---- selection ---------------------------------------------------------
  const selectedKeys = useMemo(() => {
    if (!pick) return [];
    const ia = keys.indexOf(pick.a), ib = keys.indexOf(pick.b);
    if (ia < 0 || ib < 0) return [];
    return keys.slice(Math.min(ia, ib), Math.max(ia, ib) + 1);
  }, [pick, keys]);

  const selection: Selection | null = useMemo(() => {
    if (mode === "all") return { kind: "branch" };
    if (!selectedKeys.length) return history && !keys.length ? { kind: "branch" } : null;
    const newest = selectedKeys[0];
    const oldest = selectedKeys[selectedKeys.length - 1];
    if (selectedKeys.length === 1) return newest === WORKING ? { kind: "working" } : { kind: "commit", sha: newest };
    if (oldest === WORKING) return { kind: "working" };
    return { kind: "range", from: oldest, to: newest === WORKING ? null : newest };
  }, [mode, selectedKeys, history, keys.length]);
  const selKey = JSON.stringify(selection);

  const onPick = (key: string, extend: boolean) => {
    pushNav();
    if (mode === "all") setMode("single");
    if (mode === "range" || extend) {
      setPick((p) => (!p || (p.a !== p.b && !extend) ? { a: key, b: key } : { a: p.a, b: key }));
      if (extend && mode === "single") setMode("range");
    } else {
      setPick({ a: key, b: key });
    }
    if (key !== keys[0]) setFollow(false);
  };

  // ---- diff & graph ------------------------------------------------------
  // Which request the displayed data belongs to. When it differs from what
  // is wanted, we're waiting on a *new* load (not a background refresh) and
  // show the overlay instead of stale content.
  const wantDiff = `${selKey}|${filters.ignoreWhitespace}`;
  const [diffKey, setDiffKey] = useState<string | null>(null);
  const wantGraph = `${selKey}|${scope}`;
  const [graphKey, setGraphKey] = useState<string | null>(null);

  const diffReq = useRef(0);
  useEffect(() => {
    if (!selection) {
      setDiff(null);
      return;
    }
    const id = ++diffReq.current;
    const key = wantDiff;
    setLoading((l) => l + 1);
    api
      .diff(worktree, selection, filters.ignoreWhitespace)
      .then((d) => {
        if (id === diffReq.current) {
          setDiff(d);
          setDiffKey(key);
          setError(null);
        }
      })
      .catch((e) => id === diffReq.current && setError(errorMessage(e)))
      .finally(() => setLoading((l) => l - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worktree, selKey, filters.ignoreWhitespace, tick]);

  // Which commit each changed line came from, when the selection spans several.
  const commitOf = useMemo(() => new Map(history?.commits.map((c) => [c.sha, c]) ?? []), [history]);
  const multi =
    !!selection &&
    (selection.kind === "range" ||
      (selection.kind === "branch" && keys.length > 1) ||
      (selection.kind === "commit" && (commitOf.get(selection.sha)?.parents.length ?? 0) > 1));
  const attrReq = useRef(0);
  useEffect(() => {
    if (!multi || !selection || !active) return;
    if (attr?.key === `${wantDiff}|${tick}`) return;
    const id = ++attrReq.current;
    const key = `${wantDiff}|${tick}`;
    api
      .attribution(worktree, selection, filters.ignoreWhitespace)
      .then((a) => id === attrReq.current && setAttr({ key, data: a }))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multi, active, worktree, selKey, filters.ignoreWhitespace, tick]);
  // Attribution of an older load still fits while the new one is computed,
  // as long as the selection is the same.
  const attribution = multi && attr && attr.key.startsWith(`${wantDiff}|`) ? attr.data : null;

  const graphReq = useRef(0);
  const graphTick = useRef(-1);
  useEffect(() => {
    // Hidden projects don't build graphs; on becoming visible, reuse what we
    // already have for this selection unless the worktree changed since.
    if (!active || view !== "calls" || !selection) return;
    if (graphKey === wantGraph && graphTick.current === tick) return;
    graphTick.current = tick;
    const id = ++graphReq.current;
    const key = wantGraph;
    setLoading((l) => l + 1);
    api
      .callGraph(worktree, selection, scope)
      .then((g) => {
        if (id === graphReq.current) {
          setGraph(g);
          setGraphKey(key);
        }
      })
      .catch((e) => id === graphReq.current && toast(errorMessage(e), true))
      .finally(() => setLoading((l) => l - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, view, worktree, selKey, scope, tick]);

  // ---- filtering ---------------------------------------------------------
  /** Merged-in commits plus the merges that brought them (hidden by "Hide merged-in"). */
  const foreign = useMemo(() => {
    const s = new Set(attribution?.foreign ?? []);
    for (const c of history?.commits ?? []) if (c.foreign || c.parents.length > 1) s.add(c.sha);
    return s;
  }, [attribution, history]);
  const hasForeign = !!history?.commits.some((c) => c.foreign);
  // A commit picked on its own is never hidden (a merge then shows what it brought in).
  const picked = selection?.kind === "commit" ? selection.sha : null;
  const isHidden = useCallback(
    (sha: string) => sha !== picked && (excluded.has(sha) || (!!filters.hideForeign && foreign.has(sha))),
    [excluded, filters.hideForeign, foreign, picked],
  );
  const commitBadges = useMemo(() => {
    if (!attribution) return null;
    const m = new Map<string, CommitBadge>();
    attribution.commits.forEach((sha, i) => {
      const c = commitOf.get(sha);
      m.set(sha, {
        sha,
        short: sha === WORKING ? "uncommitted" : c?.short ?? sha.slice(0, 7),
        subject: sha === WORKING ? "" : c?.subject ?? "",
        foreign: foreign.has(sha),
        hidden: isHidden(sha),
        tone: i % TONES,
      });
    });
    return m;
  }, [attribution, commitOf, foreign, isHidden]);
  const attributed = useMemo(
    () => attributeFiles(diff?.files ?? [], attribution, isHidden, (sha) => foreign.has(sha)),
    [diff, attribution, isHidden, foreign],
  );

  const { visible, hidden } = useMemo(() => {
    const visible: FileDiff[] = [];
    const hidden: { file: FileDiff; reason: FileTag }[] = [];
    for (const d of attributed.dropped) {
      hidden.push(d);
      if (showHidden) visible.push(d.file);
    }
    for (const f of attributed.files) {
      const r = hiddenReason(f, filters);
      if (r) hidden.push({ file: f, reason: r });
      if (!r || showHidden) visible.push(f);
    }
    if (attributed.dropped.length) visible.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { visible, hidden };
  }, [attributed, filters, showHidden]);

  const initialLoad = useDelayed(!error && history === null, 120);
  const diffLoading = useDelayed(!error && !!selection && diffKey !== wantDiff, 120);
  const graphLoading = useDelayed(!error && view === "calls" && !!selection && graphKey !== wantGraph, 120);

  // Related repos: prefer each one's worktree on the same branch as ours.
  const related = useMemo(() => {
    const myBranch = project.worktrees.find((w) => w.path === worktree)?.branch ?? null;
    return peers.map((p) => {
      const same = myBranch ? p.worktrees.find((w) => w.branch === myBranch && !w.bare) : undefined;
      const current = p.worktrees.find((w) => w.path === p.worktree);
      return {
        id: p.id,
        name: p.name,
        worktree: same?.path,
        branch: same?.branch ?? current?.branch ?? null,
        sameBranch: !!same,
        isNext: p.isNext,
      };
    });
  }, [peers, project.worktrees, worktree]);

  // ---- labels ------------------------------------------------------------
  const branch = history?.branch ?? project.worktrees.find((w) => w.path === worktree)?.branch ?? "HEAD";
  const targetLabel = useMemo(() => {
    if (!selection) return branch;
    const commit = (sha: string) => history?.commits.find((c) => c.sha === sha);
    switch (selection.kind) {
      case "working":
        return `uncommitted changes on \`${branch}\``;
      case "branch":
        return history?.defaultBranch && history.branch !== history.defaultBranch
          ? `all changes on \`${branch}\` since \`${history.defaultBranch}\``
          : `uncommitted changes on \`${branch}\``;
      case "commit": {
        const c = commit(selection.sha);
        return `commit ${c?.short ?? selection.sha.slice(0, 7)} ("${c?.subject ?? ""}") on \`${branch}\``;
      }
      case "range":
        return `commits ${commit(selection.from)?.short ?? selection.from.slice(0, 7)}..${
          selection.to ? commit(selection.to)?.short ?? selection.to.slice(0, 7) : "working tree"
        } on \`${branch}\``;
    }
  }, [selection, history, branch]);
  const graphTitle = targetLabel.replace(/`/g, "").replace(/^./, (c) => c.toUpperCase());

  // ---- actions -----------------------------------------------------------
  const run = useCallback(
    (p: Promise<unknown>) => {
      p.catch((e) => toast(errorMessage(e), true));
    },
    [toast],
  );
  const loadFile = useCallback(
    (path: string) => api.readFile(worktree, diff?.newRev ?? null, path).catch(() => null),
    [worktree, diff?.newRev],
  );
  const openInEditor = useCallback((file?: string, line?: number) => run(api.openInEditor(worktree, file, line)), [run, worktree]);

  const changeView = (v: View) => {
    if (v === view) return;
    pushNav();
    onView(v);
  };

  const jumpTo = (file: string, line?: number, side: "new" | "old" = "new") => {
    pushNav();
    onView("diff");
    if (!visible.some((f) => f.path === file) && hidden.some((h) => h.file.path === file)) setShowHidden(true);
    setActiveFile(file);
    setTarget({ path: file, line, side, nonce: Date.now() });
  };

  const addComment = useCallback((c: ReviewComment) => setComments((cs) => [...cs, c]), []);

  // ---- review sessions -----------------------------------------------------
  const archive = useReviewArchive(worktree);
  /** Archive a handed-over review and clear what it contained (later additions stay). */
  const archiveReview = useCallback(
    (snap: ReviewSnapshot, via: "session" | "copy", sentTo?: string) => {
      const entry = archive.add({ ...snap, at: Date.now(), via, sentTo });
      const ids = new Set(snap.comments.map((c) => c.id));
      setComments((cs) => cs.filter((c) => !ids.has(c.id)));
      setNote((n) => (n.trim() === snap.note.trim() ? "" : n));
      return entry;
    },
    [archive],
  );
  // Comments of the last rounds stay in the diff as ghosts, with the agent's answers.
  const ghosts = useMemo<Ghost[]>(
    () =>
      archive.list
        .slice(0, GHOST_ROUNDS)
        .flatMap((s) => s.comments.map((c) => ({ comment: c, round: s.n, answer: s.answers?.[c.id] }))),
    [archive.list],
  );
  const removeComment = useCallback((id: string) => setComments((cs) => cs.filter((c) => c.id !== id)), []);
  const updateComment = useCallback(
    (id: string, body: string) => setComments((cs) => cs.map((c) => (c.id === id ? { ...c, body } : c))),
    [],
  );

  const addGraphComment = (n: GraphNode, body: string) => {
    setComments((cs) => [
      ...cs,
      {
        id: newId(),
        file: n.file,
        line: n.line,
        endLine: n.endLine,
        side: n.status === "deleted" ? "old" : "new",
        code: n.signature,
        symbol: n.container ? `${n.container}.${n.name}` : n.name,
        body,
      },
    ]);
    toast("Added to review");
  };

  // ---- commits ------------------------------------------------------------
  /** Move through the history (j/k, ↑/↓); `extend` grows the range instead. */
  const step = (delta: number, extend: boolean) => {
    if (!keys.length) return;
    const cur = pick ? keys.indexOf(pick.b) : -1;
    const next = Math.min(keys.length - 1, Math.max(0, cur + delta));
    if (keys[next] === pick?.b && mode !== "all") return;
    pushNav();
    if (extend && pick) {
      setMode("range");
      setPick({ a: pick.a, b: keys[next] });
      setFollow(false);
      return;
    }
    if (mode === "all") setMode("single");
    setPick({ a: keys[next], b: keys[next] });
    setFollow(next === 0 && follow);
  };
  const toggleExcluded = useCallback((sha: string, hide?: boolean) => {
    setExcluded((s) => {
      const n = new Set(s);
      if (hide ?? !n.has(sha)) n.add(sha);
      else n.delete(sha);
      return n;
    });
  }, []);
  /** From a commit badge on a diff line. */
  const onCommit = (sha: string, action: "only" | "hide" | "show") => {
    if (action === "only") {
      pushNav();
      setMode("single");
      setPick({ a: sha, b: sha });
      setFollow(false);
      return;
    }
    if (action === "hide" && foreign.has(sha) && !excluded.has(sha) && !filters.hideForeign && hasForeign) {
      toast("Tip: “Hide merged-in” hides all code from other branches");
    }
    toggleExcluded(sha, action === "hide");
  };
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const stableOnCommit = useCallback((sha: string, a: "only" | "hide" | "show") => onCommitRef.current(sha, a), []);

  // ---- keyboard ----------------------------------------------------------
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        back();
        return;
      }
      // ⌥F / ⌘F: find in the diff, starting from the selected text.
      if (e.code === "KeyF" && (e.altKey || e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        const picked = window.getSelection()?.toString().split("\n")[0].trim() ?? "";
        setFindOpen((f) => ({ q: picked || f?.q || "", n: (f?.n ?? 0) + 1 }));
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleLeftPane();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j" || e.key === "k") {
        step(e.key === "j" ? 1 : -1, false);
      } else if (e.key === "[" || e.key === "]") {
        if (!visible.length) return;
        const cur = visible.findIndex((f) => f.path === activeFile);
        const next = Math.min(visible.length - 1, Math.max(0, cur + (e.key === "]" ? 1 : -1)));
        jumpTo(visible[next].path);
      } else if (e.key === "`") {
        const next = related.find((r) => r.isNext);
        if (!next) return;
        onJumpToPeer(next.id, next.worktree);
      } else if (e.key === "v") {
        changeView(view === "diff" ? "calls" : "diff");
      } else if (e.key === "r") {
        setTick((t) => t + 1);
      } else return;
      e.preventDefault();
    };
    // Mouse "back" button.
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
    };
  });

  return (
    <div className="workspace" hidden={!active}>
      <WorktreeBar
        project={project}
        worktree={worktree}
        history={history}
        view={view}
        onView={changeView}
        onWorktree={(path) => onWorktree(project.id, path)}
        onRefresh={() => onRescan(project.id)}
      />
      <FilterBar
        filters={filters}
        onFilters={onFilters}
        hiddenCount={showHidden ? 0 : hidden.length}
        editor={editor}
        onEditor={() => openInEditor()}
        onTerminal={() => run(api.openInTerminal(worktree))}
        onReveal={() => run(api.revealInFileManager(worktree))}
        canBack={navDepth > 0 || !!backTo}
        onBack={back}
        backName={navDepth > 0 ? project.name : backTo?.name}
        related={related}
        groupName={groupName}
        currentName={project.name}
        onJumpToPeer={onJumpToPeer}
        hasForeign={hasForeign}
      />
      <div className="stage">
        {initialLoad && <Overlay wide label={`Opening ${project.name}…`} />}
        <HistoryPane
          history={history}
          mode={mode}
          onMode={(m) => {
            if (m === mode) return;
            pushNav();
            setMode(m);
            if (m === "single" && pick) setPick({ a: pick.b, b: pick.b });
          }}
          selected={mode === "all" ? keys : selectedKeys}
          cursor={mode === "all" ? null : pick?.b ?? null}
          onPick={onPick}
          onStep={step}
          excluded={excluded}
          onExclude={toggleExcluded}
          hideForeign={!!filters.hideForeign}
          follow={follow}
          onFollow={(f) => {
            setFollow(f);
            if (f && keys[0]) {
              setMode("single");
              setPick({ a: keys[0], b: keys[0] });
            }
          }}
        />
        <Splitter size="--left-w" axis="x" sign={1} label="Resize history" />
        <main className="center fl" ref={centerRef}>
          {loading > 0 && <div className="loading-bar" />}
          {findOpen && (
            <FindBar
              key={findOpen.n}
              initial={findOpen.q}
              root={() => centerRef.current?.querySelector<HTMLElement>(".viewpane:not([hidden])") ?? null}
              version={`${view}|${wantDiff}|${tick}|${visible.length}|${[...excluded].join()}`}
              onClose={() => setFindOpen(null)}
            />
          )}
          {!initialLoad && (view === "diff" ? diffLoading : graphLoading) && (
            <Overlay label={view === "diff" ? "Loading diff…" : "Analysing call chain…"} />
          )}
          {error ? (
            <div className="empty">
              <div className="big">Something went wrong</div>
              {error}
            </div>
          ) : (
            <>
              <div className="viewpane" hidden={view !== "diff"}>
                {diff ? (
                  <DiffView
                    files={visible}
                    comments={comments}
                    ghosts={ghosts}
                    onAddComment={addComment}
                    onRemoveComment={removeComment}
                    onUpdateComment={updateComment}
                    target={target}
                    onActiveFile={setActiveFile}
                    onOpenInEditor={openInEditor}
                    sendLabel={`${comments.length} in batch`}
                    scrollRef={diffScroller}
                    loadFile={loadFile}
                    commits={commitBadges}
                    onCommit={stableOnCommit}
                  />
                ) : null}
              </div>
              <div className="viewpane" hidden={view !== "calls"}>
                <CallGraphView
                  graph={graph}
                  title={`Call chain · ${graphTitle}`}
                  scope={scope}
                  onScope={onScope}
                  hideTests={filters.hideTests}
                  onOpenDiff={(file, line, side) => jumpTo(file, line, side)}
                  onOpenEditor={(file, line) => openInEditor(file, line)}
                  onComment={addGraphComment}
                  selected={graphSel}
                  onSelect={setGraphSel}
                  comments={comments}
                  onAddComment={addComment}
                  onRemoveComment={removeComment}
                  onUpdateComment={updateComment}
                />
              </div>
            </>
          )}
        </main>
        <Splitter size="--right-w" axis="x" sign={-1} label="Resize side panel" />
        <div className="right">
          <FilesPane
            visible={visible}
            hidden={hidden}
            showHidden={showHidden}
            onShowHidden={setShowHidden}
            active={activeFile}
            onPick={(p) => jumpTo(p)}
          />
          <Splitter size="--files-h" axis="y" sign={1} label="Resize file list" />
          <ReviewPane
            worktree={worktree}
            repoName={project.name}
            tabId={tabId}
            scope={reviewScope}
            scopeName={reviewRequest?.group?.name ?? groupName ?? branch}
            target={targetLabel}
            comments={comments}
            onRemove={removeComment}
            onJump={(c) => jumpTo(c.file, c.line || undefined, c.side)}
            onFocusTab={() => onJumpToPeer(project.id, worktree)}
            onClear={() => {
              setComments([]);
              setNote("");
            }}
            note={note}
            onNote={setNote}
            toast={toast}
            diskVersion={diskVersion}
            sessions={archive.list}
            onArchive={archiveReview}
            request={reviewRequest}
            onRequestDone={onReviewDone}
          />
        </div>
      </div>
      <footer className="statusbar">
        <span>{tildify(worktree)}</span>
        <span className="grow" />
        <span>⌘B sidebar</span>
        <span>↑↓ j/k history</span>
        <span>⌥F find</span>
        <span>[ ] files</span>
        <span>v toggle view</span>
        {related.length > 0 && <span>` next repo</span>}
        <span>r refresh</span>
      </footer>
    </div>
  );
});
