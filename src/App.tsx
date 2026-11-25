import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, errorMessage } from "./api";
import { Logo } from "./components/Icons";
import { ProjectTabs, type TabInfo, type ThemePref } from "./components/ProjectTabs";
import { Workspace } from "./components/Workspace";
import type { CliStatus, Editor, Filters, GraphScope, Peer, PendingReview, Project, PullRequest, ReviewAnswer, ReviewRequest, View } from "./types";
import { applyAnswers } from "./reviewAnswers";
import { useUpdater } from "./updater";
import { isMac, tildify } from "./util";

/** One tab per repo + worktree, so a repo can be open on several worktrees at once. */
interface Tab {
  project: Project;
  worktree: string;
}

const tabId = (projectId: string, worktree: string) => `${projectId}::${worktree}`;

/** Tabs are grouped by the branch their worktree has checked out. */
function groupOf(project: Project, worktree: string): TabInfo["group"] {
  const w = project.worktrees.find((x) => x.path === worktree);
  if (w?.branch) return { key: `b:${w.branch}`, label: w.branch };
  return { key: `d:${worktree}`, label: w ? `detached ${w.head.slice(0, 7)}` : worktree.split(/[\\/]/).pop() || worktree };
}

interface Toast {
  id: number;
  msg: string;
  err: boolean;
}

interface SavedTab {
  path: string;
  worktree: string;
}

const STORE = {
  tabs: "codewart.tabs",
  active: "codewart.active",
  theme: "codewart.theme",
  filters: "codewart.filters",
  view: "codewart.view",
  scope: "codewart.scope",
};

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

const NO_PEERS: Peer[] = [];
/** How often every open repo's worktrees (branches, last update) are re-read. */
const RESCAN_MS = 30_000;
/** How often PR status is re-fetched from GitHub. */
const PR_MS = 120_000;
const prKey = (projectId: string, branch: string) => `${projectId}::${branch}`;

/** macOS: the strip the window buttons sit in, with the logo, name and version centred. */
function TitleStrip() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(null));
  }, []);
  return (
    <div className="titlestrip" data-tauri-drag-region>
      <div className="apptitle" data-tauri-drag-region>
        <Logo size={15} />
        CodeWart
        {version && <span>{version}</span>}
      </div>
    </div>
  );
}

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemePref>(() => load(STORE.theme, "system"));
  const [filters, setFilters] = useState<Filters>(() =>
    load(STORE.filters, { hideTests: false, hideNonFunctional: true, ignoreWhitespace: false }),
  );
  // Diff / call chain and graph scope are shared by all repos (kept when switching).
  const [view, setView] = useState<View>(() => load(STORE.view, "diff"));
  const [scope, setScope] = useState<GraphScope>(() => load(STORE.scope, "neighbours"));
  const [editor, setEditor] = useState<Editor | null>(null);
  const [cli, setCli] = useState<CliStatus | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [booted, setBooted] = useState(false);

  const toast = useCallback((msg: string, err = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, err }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), err ? 6000 : 2600);
  }, []);

  const { update, installUpdate } = useUpdater(toast);

  // ---- `wart` called from a branch: switch to it and make it stand out ------
  const [called, setCalled] = useState<{ ids: string[]; n: number } | null>(null);
  const calledFrom = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setActiveId(ids[0]);
    const n = Date.now();
    setCalled({ ids, n });
    setTimeout(() => setCalled((c) => (c?.n === n ? null : c)), 2600);
  }, []);

  // ---- theme ---------------------------------------------------------------
  useEffect(() => {
    save(STORE.theme, theme);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const t = theme === "system" ? (mq.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = t;
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => save(STORE.filters, filters), [filters]);
  useEffect(() => save(STORE.view, view), [view]);
  useEffect(() => save(STORE.scope, scope), [scope]);

  // ---- persistence ---------------------------------------------------------
  useEffect(() => {
    if (!booted) return;
    save(
      STORE.tabs,
      tabs.map<SavedTab>((t) => ({ path: t.project.mainRoot, worktree: t.worktree })),
    );
    save(STORE.active, activeId);
  }, [tabs, activeId, booted]);

  // ---- opening projects ------------------------------------------------------
  /** Open one repository on a worktree as a tab (or focus it if already open). */
  const openRepo = useCallback(
    async (path: string, opts: { activate?: boolean; worktree?: string; quiet?: boolean } = {}) => {
      try {
        const project = await api.openProject(path);
        const wt = opts.worktree && project.worktrees.some((w) => w.path === opts.worktree) ? opts.worktree : project.openedWorktree;
        const id = tabId(project.id, wt);
        setTabs((ts) => {
          // Every tab of this repo gets the fresh worktree list.
          const next = ts.map((t) => (t.project.id === project.id ? { ...t, project } : t));
          return next.some((t) => tabId(t.project.id, t.worktree) === id) ? next : [...next, { project, worktree: wt }];
        });
        if (opts.activate !== false) setActiveId(id);
        return id;
      } catch (e) {
        if (!opts.quiet) toast(errorMessage(e), true);
        return null;
      }
    },
    [toast],
  );

  /** Open whatever is at `path`: a repo, or every repo in a folder (as a group). */
  const openPath = useCallback(
    async (path: string, opts: { activate?: boolean; cli?: boolean } = {}) => {
      try {
        const d = await api.discover(path);
        if (d.kind === "repo") {
          const id = await openRepo(d.path, opts);
          if (id && opts.cli) calledFrom([id]);
          return;
        }
        const ids: string[] = [];
        for (const repo of d.repos) {
          const id = await openRepo(repo, { activate: false, worktree: repo });
          if (id) ids.push(id);
        }
        if (opts.cli) calledFrom(ids);
        else if (ids[0] && opts.activate !== false) setActiveId(ids[0]);
        toast(`Opened ${d.repos.length} repositories from ${d.name}`);
      } catch (e) {
        toast(errorMessage(e), true);
      }
    },
    [openRepo, toast, calledFrom],
  );

  const bootRef = useRef(false);
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    (async () => {
      api.editorInfo().then(setEditor).catch(() => {});
      api.cliStatus().then(setCli).catch(() => {});
      // An update replaced the app: bring an installed `wart` / Claude skill up to date.
      api
        .refreshInstalls()
        .then((files) => files.length && toast(`Updated ${files.map((f) => f.split(/[\\/]/).slice(-2).join("/")).join(", ")} for this version`))
        .catch(() => {});
      const saved = load<SavedTab[]>(STORE.tabs, []);
      const savedActive = load<string | null>(STORE.active, null);
      for (const s of saved) await openRepo(s.path, { activate: false, worktree: s.worktree, quiet: true });
      if (savedActive) setActiveId((a) => a ?? savedActive);
      const launch = await api.launchPaths().catch(() => [] as string[]);
      const launchReview = await api.launchReview().catch(() => null);
      for (const p of launch) if (p !== launchReview?.path) await openPath(p, { cli: true });
      if (launchReview) await onReviewRequestRef.current(launchReview);
      setTabs((ts) => {
        setActiveId((a) => (a && ts.some((t) => tabId(t.project.id, t.worktree) === a) ? a : ts[0] ? tabId(ts[0].project.id, ts[0].worktree) : null));
        return ts;
      });
      setBooted(true);
    })();
  }, [openRepo, openPath, toast]);

  useEffect(() => {
    const un = listen<string>("open-path", (e) => void openPath(e.payload, { cli: true }));
    return () => {
      void un.then((f) => f());
    };
  }, [openPath]);

  // ---- review requests from agents (`wart review`) -----------------------------
  const [reviews, setReviews] = useState<Record<string, PendingReview>>({});
  const reviewsRef = useRef(reviews);
  reviewsRef.current = reviews;
  const onReviewRequest = useCallback(
    async (r: ReviewRequest) => {
      // A folder of repos (e.g. one feature's worktrees): one request for all of them.
      const d = await api.discover(r.path).catch(() => null);
      const group = d?.kind === "group" ? { name: d.name, repos: d.repos.length } : undefined;
      const ids: string[] = [];
      for (const repo of d?.kind === "group" ? d.repos : [r.path]) {
        const id = await openRepo(repo, { activate: false, worktree: group ? repo : undefined });
        if (id) ids.push(id);
      }
      if (!ids.length) return;
      const known = ids.some((id) => reviewsRef.current[id]?.reply === r.reply);
      setReviews((m) => {
        const next = { ...m };
        const at = ids.map((id) => m[id]).find((x) => x?.reply === r.reply)?.at ?? Date.now();
        for (const id of ids) next[id] = { reply: r.reply, message: r.message ?? "", at, group };
        return next;
      });
      if (known) return; // the agent re-ran after --timeout: same request
      calledFrom(ids);
      const t = tabsRef.current.find((x) => tabId(x.project.id, x.worktree) === ids[0]);
      const where = group
        ? `${group.name} (${ids.length} repos)`
        : t
          ? `${t.project.name} · ${groupOf(t.project, t.worktree).label}`
          : r.path;
      toast(`Review requested for ${where}`);
      const body = r.message?.trim() ? `${where}\n${r.message.trim()}` : `${where}: an agent is waiting for your review`;
      void api.reviewAlert("Review requested", body).catch(() => {});
    },
    [openRepo, toast, calledFrom],
  );
  const onReviewRequestRef = useRef(onReviewRequest);
  onReviewRequestRef.current = onReviewRequest;
  useEffect(() => {
    const un = listen<ReviewRequest>("review-request", (e) => void onReviewRequestRef.current(e.payload));
    return () => {
      void un.then((f) => f());
    };
  }, []);
  /** A request was answered (or dropped): clear it on every tab sharing it. */
  const reviewDone = useCallback(
    (reply: string) => setReviews((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v.reply !== reply))),
    [],
  );
  // Drop requests whose agent stopped waiting (cancelled, or never came back after --timeout).
  useEffect(() => {
    const ids = Object.keys(reviews);
    if (!ids.length) return;
    const t = window.setInterval(() => {
      const seen = new Set<string>(); // tabs of a folder share one request
      for (const [id, r] of Object.entries(reviewsRef.current)) {
        if (seen.has(r.reply)) continue;
        seen.add(r.reply);
        void api.reviewWaiting(r.reply).then((alive) => {
          if (alive || reviewsRef.current[id]?.reply !== r.reply) return;
          reviewDone(r.reply);
          toast("The agent stopped waiting for the review");
        });
      }
    }, 5000);
    return () => window.clearInterval(t);
  }, [reviews, reviewDone, toast]);

  // ---- the agent's answers to review comments (`wart answer`) ------------------
  const onAnswer = useCallback(
    (a: ReviewAnswer) => {
      const r = applyAnswers(a.review, a.text);
      if (!r) toast(`Got answers for review ${a.review}, but no sent review has that id`, true);
      else {
        const rounds = [...new Set(r.rounds)];
        const which = rounds.length === 1 ? `review #${rounds[0]}` : `review ${a.review} (${rounds.length} repos)`;
        toast(r.answered ? `The agent answered ${r.answered} comment${r.answered === 1 ? "" : "s"} of ${which}` : `The agent replied to ${which}`);
      }
    },
    [toast],
  );
  useEffect(() => {
    if (!booted) return;
    api.launchAnswers().then((list) => list.forEach(onAnswer)).catch(() => {});
    const un = listen<ReviewAnswer>("review-answer", (e) => onAnswer(e.payload));
    return () => {
      void un.then((f) => f());
    };
  }, [booted, onAnswer]);

  // ---- previous tab, for Back across repos -------------------------------------
  const visited = useRef<string[]>([]);
  useEffect(() => {
    if (!activeId) return;
    visited.current = [...visited.current.filter((x) => x !== activeId), activeId].slice(-30);
  }, [activeId]);
  /** Back to the previous tab: forget the tab we leave, so Back keeps going back. */
  const backTo = useCallback((id: string) => {
    const v = visited.current;
    visited.current = v.slice(0, -1);
    setActiveId(id);
  }, []);

  // Stable callbacks: Workspace is memoised, so inline lambdas would make every
  // open (hidden) project re-render on each tab switch.
  /** Focus the tab for a repo + worktree, opening it if needed (worktree dropdown, related repos). */
  const focusWorktree = useCallback((projectId: string, wt: string) => {
    const id = tabId(projectId, wt);
    setTabs((ts) => {
      if (ts.some((t) => tabId(t.project.id, t.worktree) === id)) return ts;
      const src = ts.find((t) => t.project.id === projectId);
      return src ? [...ts, { project: src.project, worktree: wt }] : ts;
    });
    setActiveId(id);
  }, []);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  /**
   * Re-read a repo's worktrees (branches and last-update times change while
   * agents work) without opening tabs. Unchanged data keeps the same objects,
   * so the memoised workspaces don't re-render.
   */
  const rescan = useCallback(
    (projectId: string, quiet = false) => {
      const t = tabsRef.current.find((x) => x.project.id === projectId);
      if (!t) return;
      api
        .openProject(t.project.mainRoot)
        .then((project) => {
          const { openedWorktree: _a, ...fresh } = project;
          const { openedWorktree: _b, ...old } = t.project;
          if (JSON.stringify(fresh) === JSON.stringify(old)) return;
          setTabs((ts) => ts.map((x) => (x.project.id === project.id ? { ...x, project } : x)));
        })
        .catch((e) => !quiet && toast(errorMessage(e), true));
    },
    [toast],
  );
  const rescanQuiet = useCallback((projectId: string) => rescan(projectId, true), [rescan]);
  useEffect(() => {
    if (!booted) return;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      for (const pid of new Set(tabsRef.current.map((t) => t.project.id))) rescan(pid, true);
    }, RESCAN_MS);
    return () => window.clearInterval(id);
  }, [booted, rescan]);

  // ---- pull requests (via `gh`, optional) ------------------------------------
  const [prs, setPrs] = useState<Record<string, PullRequest | null>>({});
  const prsRef = useRef(prs);
  prsRef.current = prs;
  const fetchPrs = useCallback((force: boolean) => {
    const seen = new Set<string>();
    for (const t of tabsRef.current) {
      const branch = t.project.worktrees.find((w) => w.path === t.worktree)?.branch;
      if (!branch) continue;
      const key = prKey(t.project.id, branch);
      if (seen.has(key) || (!force && key in prsRef.current)) continue;
      seen.add(key);
      api
        .prStatus(t.worktree, branch)
        .then((pr) =>
          setPrs((m) => (JSON.stringify(m[key] ?? null) === JSON.stringify(pr ?? null) && key in m ? m : { ...m, [key]: pr ?? null })),
        )
        .catch(() => setPrs((m) => (key in m ? m : { ...m, [key]: null })));
    }
  }, []);
  useEffect(() => fetchPrs(false), [tabs, fetchPrs]);
  useEffect(() => {
    const id = window.setInterval(() => !document.hidden && fetchPrs(true), PR_MS);
    return () => window.clearInterval(id);
  }, [fetchPrs]);
  const jumpToPeer = useCallback(
    (projectId: string, worktree?: string) => {
      const wt = worktree ?? tabsRef.current.find((t) => t.project.id === projectId)?.worktree;
      if (wt) focusWorktree(projectId, wt);
    },
    [focusWorktree],
  );

  const pickFolder = async () => {
    const dir = await openDialog({ directory: true, multiple: false, title: "Open a repository, worktree or folder of repos" });
    if (typeof dir === "string") await openPath(dir);
  };

  const closeTabs = (ids: string[]) => {
    setTabs((ts) => {
      const gone = (t: Tab) => ids.includes(tabId(t.project.id, t.worktree));
      const first = ts.findIndex(gone);
      const next = ts.filter((t) => !gone(t));
      const after = next[Math.max(0, first - 1)];
      if (activeId && ids.includes(activeId)) setActiveId(after ? tabId(after.project.id, after.worktree) : null);
      return next;
    });
  };

  const installCli = async () => {
    try {
      const st = await api.installCli();
      setCli(st);
      toast(
        st.onPath
          ? `Installed: run "wart ." in any repo (${tildify(st.path)})`
          : `Installed ${tildify(st.path)}. Add its folder to your PATH to use "wart".`,
        !st.onPath,
      );
    } catch (e) {
      toast(errorMessage(e), true);
    }
  };

  const infos = useMemo<TabInfo[]>(
    () =>
      tabs.map((t) => {
        const w = t.project.worktrees.find((x) => x.path === t.worktree);
        return {
          id: tabId(t.project.id, t.worktree),
          project: t.project,
          worktree: t.worktree,
          group: groupOf(t.project, t.worktree),
          linked: !w?.isMain,
          updated: w?.updated ?? 0,
          pr: w?.branch ? prs[prKey(t.project.id, w.branch)] ?? null : null,
          awaitingReview: !!reviews[tabId(t.project.id, t.worktree)],
        };
      }),
    [tabs, prs, reviews],
  );

  // Other repos on the same branch, per tab (stable arrays for memoised workspaces).
  const peers = useMemo(() => {
    const m = new Map<string, Peer[]>();
    for (const t of infos) {
      const members = infos.filter((o) => o.group.key === t.group.key);
      if (members.length < 2) continue;
      const me = members.findIndex((o) => o.id === t.id);
      const next = members[(me + 1) % members.length]?.id;
      m.set(
        t.id,
        members
          .filter((o) => o.id !== t.id)
          .map((o) => ({
            id: o.project.id,
            name: o.project.name,
            worktree: o.worktree,
            worktrees: o.project.worktrees,
            isNext: o.id === next,
          })),
      );
    }
    return m;
  }, [infos]);

  const active = infos.find((t) => t.id === activeId) ?? null;
  // Where Back goes from the active tab when it has no history of its own.
  const prevTab = useMemo(() => {
    const v = visited.current;
    for (let i = v.length - 1; i >= 0; i--) {
      const t = infos.find((x) => x.id === v[i]);
      if (t && t.id !== activeId) return { id: t.id, name: t.project.name };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, infos]);
  useEffect(() => {
    document.title = active ? `${active.project.name} · ${active.group.label} — CodeWart` : "CodeWart";
  }, [active]);

  return (
    <div className={`app${isMac ? " mac" : ""}`}>
      {isMac && <TitleStrip />}
      <ProjectTabs
        tabs={infos}
        activeId={activeId}
        called={called}
        onSelect={setActiveId}
        onClose={(id) => closeTabs([id])}
        onCloseGroup={(key) => closeTabs(infos.filter((t) => t.group.key === key).map((t) => t.id))}
        onOpenPr={(url) => api.openUrl(url).catch((e) => toast(errorMessage(e), true))}
        onOpen={pickFolder}
        theme={theme}
        onTheme={setTheme}
        cli={cli}
        onInstallCli={installCli}
        update={update}
        onUpdate={installUpdate}
      />
      {infos.map((t) => (
        <Workspace
          key={t.id}
          project={t.project}
          worktree={t.worktree}
          active={t.id === activeId}
          filters={filters}
          onFilters={setFilters}
          editor={editor}
          onWorktree={focusWorktree}
          onRescan={rescan}
          onActivity={rescanQuiet}
          view={view}
          onView={setView}
          scope={scope}
          onScope={setScope}
          peers={peers.get(t.id) ?? NO_PEERS}
          groupName={t.group.label}
          tabId={t.id}
          reviewRequest={reviews[t.id]}
          reviewScope={reviews[t.id]?.group ? `r:${reviews[t.id].reply}` : `g:${t.group.key}`}
          backTo={t.id === activeId ? prevTab : null}
          onBackTo={backTo}
          onReviewDone={reviewDone}
          onJumpToPeer={jumpToPeer}
          toast={toast}
        />
      ))}
      {booted && tabs.length === 0 && (
        <div className="fl" style={{ flex: 1, display: "grid", placeItems: "center", background: "var(--pane)" }}>
          <div className="empty">
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
              <Logo size={48} />
            </div>
            <div className="big">Review what your agents wrote</div>
            <p style={{ margin: "0 0 20px" }}>
              Open a git repository, any of its worktrees, or a folder holding several repos. CodeWart finds the main
              checkout and all sibling worktrees automatically.
            </p>
            <button className="btn pri" onClick={pickFolder}>
              Open project…
            </button>
            <p className="m" style={{ marginTop: 18 }}>
              or run <code>wart .</code> inside a repo
              {cli && !cli.installed && (
                <>
                  {" · "}
                  <button className="linkbtn" onClick={installCli}>
                    install the wart command
                  </button>
                </>
              )}
            </p>
          </div>
        </div>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.err ? " err" : ""}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
