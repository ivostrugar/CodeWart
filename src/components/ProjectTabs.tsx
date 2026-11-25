import { useEffect, useRef, useState } from "react";
import type { CliStatus, Project, PullRequest } from "../types";
import type { UpdateState } from "../updater";
import { relativeTime, tildify } from "../util";
import { Branch, Close, Download, Monitor, Moon, Sun, Plus, Terminal, WorktreeIcon } from "./Icons";

export type ThemePref = "system" | "dark" | "light";

/** One open repo + worktree. Tabs sharing a group key (the branch) are drawn together. */
export interface TabInfo {
  id: string;
  project: Project;
  worktree: string;
  group: { key: string; label: string };
  /** A linked worktree (`git worktree add`) rather than the repo's main checkout. */
  linked: boolean;
  /** Last activity, unix seconds. */
  updated: number;
  pr: PullRequest | null;
  /** An agent is waiting for a review (`wart review`). */
  awaitingReview: boolean;
}

interface Props {
  tabs: TabInfo[];
  activeId: string | null;
  /** Tabs a `wart` command was just run from (flashed; `n` restarts the flash). */
  called?: { ids: string[]; n: number } | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCloseGroup: (key: string) => void;
  onOpenPr: (url: string) => void;
  onOpen: () => void;
  theme: ThemePref;
  onTheme: (t: ThemePref) => void;
  cli: CliStatus | null;
  onInstallCli: () => void;
  /** A newer release is available (or installing). */
  update?: UpdateState | null;
  onUpdate?: () => void;
}

const NEXT: Record<ThemePref, ThemePref> = { system: "dark", dark: "light", light: "system" };
const GROUP_TONES = 6; // --g1 … --g6 in styles.css

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

interface Unit {
  key: string;
  label: string;
  tone: string;
  updated: number;
  tabs: TabInfo[];
}

/**
 * Group tabs by branch, most recently active group first. Each group keeps
 * the tone its name hashes to unless another open group already took it
 * (assigned in key order, so re-sorting never swaps colours).
 */
function toUnits(tabs: TabInfo[]): Unit[] {
  const units = new Map<string, Unit>();
  for (const t of tabs) {
    const u = units.get(t.group.key);
    if (u) {
      u.tabs.push(t);
      u.updated = Math.max(u.updated, t.updated);
    } else units.set(t.group.key, { key: t.group.key, label: t.group.label, tone: "", updated: t.updated, tabs: [t] });
  }
  const used = new Set<number>();
  for (const u of [...units.values()].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    if (used.size >= GROUP_TONES) used.clear();
    let i = hash(u.key) % GROUP_TONES;
    while (used.has(i)) i = (i + 1) % GROUP_TONES;
    used.add(i);
    u.tone = `var(--g${i + 1})`;
  }
  return [...units.values()].sort((a, b) => b.updated - a.updated || (a.label < b.label ? -1 : 1));
}

function prInfo(pr: PullRequest): { cls: string; label: string; tip: string } {
  const state = pr.state === "OPEN" ? (pr.isDraft ? "draft" : "open") : pr.state.toLowerCase();
  const review =
    pr.state === "OPEN" && pr.reviewDecision === "APPROVED"
      ? { mark: " ✓", tip: " · approved" }
      : pr.state === "OPEN" && pr.reviewDecision === "CHANGES_REQUESTED"
        ? { mark: " !", tip: " · changes requested" }
        : { mark: "", tip: "" };
  return { cls: state, label: `#${pr.number}${review.mark}`, tip: `PR #${pr.number} · ${state}${review.tip}\n${pr.title}\nClick to open on GitHub` };
}

export function ProjectTabs(p: Props) {
  const units = toUnits(p.tabs);
  // Re-render every minute so the "updated 3m" ages stay current.
  const [, setClock] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setClock((c) => c + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const nav = useRef<HTMLElement>(null);
  const calledIds = new Set(p.called?.ids ?? []);
  // Bring the branch `wart` was called from into view.
  useEffect(() => {
    if (!p.called) return;
    requestAnimationFrame(() =>
      nav.current?.querySelector(".tabgroup.called")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }),
    );
  }, [p.called]);

  const tab = (t: TabInfo) => {
    const pr = t.pr && prInfo(t.pr);
    const kind = t.linked ? "Linked worktree" : "Main checkout";
    return (
      <button
        key={t.id}
        className={`ptab${t.id === p.activeId ? " on" : ""}${calledIds.has(t.id) ? " called" : ""}`}
        onClick={() => p.onSelect(t.id)}
        onAuxClick={(e) => e.button === 1 && p.onClose(t.id)}
        title={`${t.project.name} · ${kind}\n${tildify(t.worktree)}${t.updated ? `\nUpdated ${relativeTime(t.updated)} ago` : ""}`}
      >
        <span className={`kind${t.linked ? " wt" : ""}`} aria-label={kind}>
          {t.linked ? <WorktreeIcon size={13} /> : <Branch size={13} />}
        </span>
        {t.project.name}
        {t.awaitingReview && <span className="waitdot" title="An agent is waiting for your review" aria-label="Review requested" />}
        {pr && (
          <span
            className={`prpill ${pr.cls}`}
            role="link"
            title={pr.tip}
            onClick={(e) => {
              e.stopPropagation();
              p.onOpenPr(t.pr!.url);
            }}
          >
            {pr.label}
          </span>
        )}
        <span
          className="x"
          role="button"
          aria-label={`Close ${t.project.name} (${t.group.label})`}
          onClick={(e) => {
            e.stopPropagation();
            p.onClose(t.id);
          }}
        >
          <Close />
        </span>
      </button>
    );
  };

  return (
    <header className="tabsbar fl" data-tauri-drag-region>
      <nav ref={nav} className="ptabs" aria-label="Open projects" data-tauri-drag-region>
        {units.map((u) => (
          <div
            key={u.tabs.some((t) => calledIds.has(t.id)) ? `${u.key}#${p.called!.n}` : u.key}
            className={`tabgroup${u.tabs.some((t) => t.id === p.activeId) ? " active" : ""}${u.tabs.some((t) => calledIds.has(t.id)) ? " called" : ""}`}
            style={{ ["--gc" as string]: u.tone }}
            role="group"
            aria-label={`Repositories on ${u.label}`}
          >
            <span className="glabel" title={`Branch ${u.label}${u.updated ? ` · updated ${relativeTime(u.updated)} ago` : ""}`}>
              {u.label}
              {u.updated > 0 && <span className="age">{relativeTime(u.updated)}</span>}
              <span
                className="x"
                role="button"
                aria-label={`Close all repositories on ${u.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  p.onCloseGroup(u.key);
                }}
              >
                <Close />
              </span>
            </span>
            {u.tabs.map(tab)}
          </div>
        ))}
        <button className="iconbtn" onClick={p.onOpen} aria-label="Open project" data-tip="Open repo, worktree or folder…" data-tip-left>
          <Plus />
        </button>
      </nav>
      {p.update && (
        <button
          className="clibtn upd"
          onClick={p.onUpdate}
          disabled={p.update.progress != null}
          data-tip={`Install CodeWart ${p.update.version} and restart`}
        >
          <Download size={14} />
          {p.update.progress == null ? `Update to v${p.update.version}` : `Updating… ${p.update.progress}%`}
        </button>
      )}
      {p.cli && !p.cli.installed && (
        <button className="clibtn" onClick={p.onInstallCli} data-tip={`Install the "wart" command (${tildify(p.cli.path)})`}>
          <Terminal size={14} /> Install <code>wart</code>
        </button>
      )}
      <button className="iconbtn" onClick={() => p.onTheme(NEXT[p.theme])} aria-label={`Theme: ${p.theme}`} data-tip={`Theme: ${p.theme}`}>
        {p.theme === "system" ? <Monitor /> : p.theme === "dark" ? <Moon /> : <Sun />}
      </button>
    </header>
  );
}
