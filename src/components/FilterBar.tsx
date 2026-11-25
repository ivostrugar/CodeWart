import type { Editor, Filters } from "../types";
import { fileManagerName } from "../util";
import { Back, Check, Code, Folder, Forward, Terminal } from "./Icons";

interface Props {
  filters: Filters;
  onFilters: (f: Filters) => void;
  hiddenCount: number;
  editor: Editor | null;
  onEditor: () => void;
  onTerminal: () => void;
  onReveal: () => void;
  canBack: boolean;
  onBack: () => void;
  /** Repo that Back returns to (this one, or the tab you came from). */
  backName?: string;
  related: { id: string; name: string; worktree?: string; branch: string | null; sameBranch: boolean; isNext: boolean }[];
  groupName?: string;
  /** Name of the repo this workspace shows (label of the rotate pill). */
  currentName: string;
  onJumpToPeer: (projectId: string, worktree?: string) => void;
  /** The branch contains work merged in from other branches. */
  hasForeign?: boolean;
}

function Pill({ on, label, onClick, tip }: { on: boolean; label: string; onClick: () => void; tip: string }) {
  return (
    <button className={`tg${on ? " on" : ""}`} onClick={onClick} aria-pressed={on} title={tip}>
      <span className="bx">{on && <Check stroke="var(--onacc)" />}</span>
      {label}
    </button>
  );
}

export function FilterBar({ filters, onFilters, hiddenCount, editor, onEditor, onTerminal, onReveal, canBack, onBack, backName, related, groupName, currentName, onJumpToPeer, hasForeign }: Props) {
  const toggle = (k: keyof Filters) => onFilters({ ...filters, [k]: !filters[k] });
  return (
    <div className="filterbar">
      <button
        className="backbtn"
        onClick={onBack}
        disabled={!canBack}
        aria-label={backName ? `Back to ${backName}` : "Back"}
        data-tip="Back (⌥←)"
        data-tip-left
      >
        <Back size={14} />
        <span className="two">
          Back
          {canBack && backName && <small>{backName}</small>}
        </span>
      </button>
      {related.length > 0 &&
        (() => {
          const next = related.find((r) => r.isNext) ?? related[0];
          return (
            <nav className="related" aria-label={`Related repositories${groupName ? ` in ${groupName}` : ""}`}>
              <span className="rel cur" aria-current="true" title={`You're in ${currentName}${groupName ? ` · ${groupName}` : ""}`}>
                {currentName}
              </span>
              <button
                className={`rel nextbtn${next.sameBranch ? " same" : ""}`}
                onClick={() => onJumpToPeer(next.id, next.worktree)}
                aria-label={`Next repository: ${next.name}`}
                title={`Next repo (\`): ${next.name}${next.sameBranch ? ` on the same branch (${next.branch})` : next.branch ? ` (${next.branch}, no worktree on this branch)` : ""}${related.length > 1 ? ` · ${related.length + 1} repos in this group` : ""}`}
              >
                <span className="two">
                  Next
                  <small>
                    {next.name}
                    {!next.sameBranch && next.branch ? ` · ${next.branch}` : ""}
                  </small>
                </span>
                <Forward size={14} />
              </button>
            </nav>
          );
        })()}
      <span className="grow" />
      {hiddenCount > 0 && (
        <span className="m" style={{ marginRight: 6 }}>
          {hiddenCount} file{hiddenCount === 1 ? "" : "s"} hidden
        </span>
      )}
      {(hasForeign || filters.hideForeign) && (
        <Pill
          on={!!filters.hideForeign}
          label="Hide merged-in"
          onClick={() => toggle("hideForeign")}
          tip="Hide code that came in through merges from other branches (marked “merged in” in the history)"
        />
      )}
      <Pill
        on={filters.hideTests}
        label="Hide tests"
        onClick={() => toggle("hideTests")}
        tip="Hide test sources, fixtures and snapshots"
      />
      <Pill
        on={filters.hideNonFunctional}
        label="Hide non-functional"
        onClick={() => toggle("hideNonFunctional")}
        tip="Hide lockfiles, assets, generated code, docs, config, pure renames and whitespace- or comment-only changes"
      />
      <Pill
        on={filters.ignoreWhitespace}
        label="Ignore whitespace"
        onClick={() => toggle("ignoreWhitespace")}
        tip="Hide indentation and whitespace changes inside files"
      />
      <div className="actions" style={{ marginLeft: 6 }}>
        <button className="iconbtn" onClick={onEditor} aria-label="Open in editor" data-tip={`Open in ${editor?.label ?? "editor"}`}>
          <Code />
        </button>
        <button className="iconbtn" onClick={onTerminal} aria-label="Open in terminal" data-tip="Open in terminal">
          <Terminal />
        </button>
        <button className="iconbtn" onClick={onReveal} aria-label={`Show in ${fileManagerName}`} data-tip={`Show in ${fileManagerName}`}>
          <Folder />
        </button>
      </div>
    </div>
  );
}
