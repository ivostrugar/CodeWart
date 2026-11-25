import { useId, type SVGProps } from "react";
import { SIGNET, SIGNET_VIEWBOX } from "./signet";

type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...rest }: P) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...rest,
  };
}

/** CodeWart owl signet. Takes the text colour; the eyes are knocked out so the
 *  background shows through, and the folded "page" uses --logo-fold. */
export function Logo({ size = 20 }: { size?: number }) {
  const id = "cw-logo" + useId().replace(/:/g, "");
  return (
    <svg width={size * 0.876} height={size} viewBox={SIGNET_VIEWBOX} aria-hidden="true">
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="2048" height="2048">
        <path fill="#fff" d={SIGNET.body} />
        <path fill="#000" d={SIGNET.eyes} />
        <path fill="#fff" d={SIGNET.chevL} />
        <path fill="#fff" d={SIGNET.chevR} />
      </mask>
      <rect width="2048" height="2048" fill="currentColor" mask={`url(#${id})`} />
      <path fill="var(--logo-fold)" d={SIGNET.fold} />
    </svg>
  );
}

export const Plus = (p: P) => (
  <svg {...base(p)}><path d="M8 3v10M3 8h10" /></svg>
);
export const Close = (p: P) => (
  <svg {...base({ size: 12, ...p })}><path d="M4 4l8 8M12 4l-8 8" /></svg>
);
export const ChevronDown = (p: P) => (
  <svg {...base({ size: 14, ...p })}><path d="M4 6l4 4 4-4" /></svg>
);
export const Back = (p: P) => (
  <svg {...base(p)}><path d="M13 8H3M7 4L3 8l4 4" /></svg>
);
export const ChevronRight = (p: P) => (
  <svg {...base({ size: 14, ...p })}><path d="M6 4l4 4-4 4" /></svg>
);
export const Check = (p: P) => (
  <svg {...base({ size: 9, ...p })} viewBox="0 0 9 9" strokeWidth={1.6}><path d="M1.5 4.8l2 2L7.5 2" /></svg>
);
export const Code = (p: P) => (
  <svg {...base(p)}><path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5M9 3l-2 10" /></svg>
);
export const Download = (p: P) => (
  <svg {...base(p)}><path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10" /></svg>
);
export const Terminal = (p: P) => (
  <svg {...base(p)}><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" /><path d="M4.5 6.5L6.5 8l-2 1.5M8.5 10h3" /></svg>
);
export const Folder = (p: P) => (
  <svg {...base(p)}><path d="M1.75 4.25a1.5 1.5 0 011.5-1.5h3l1.5 1.75h5a1.5 1.5 0 011.5 1.5v5.75a1.5 1.5 0 01-1.5 1.5h-9.5a1.5 1.5 0 01-1.5-1.5z" /></svg>
);
export const Sun = (p: P) => (
  <svg {...base(p)}><circle cx="8" cy="8" r="3" /><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" /></svg>
);
export const Moon = (p: P) => (
  <svg {...base(p)}><path d="M13.5 9.5A5.5 5.5 0 016.5 2.5a5.5 5.5 0 107 7z" /></svg>
);
export const Monitor = (p: P) => (
  <svg {...base(p)}><rect x="1.75" y="2.75" width="12.5" height="8.5" rx="1.5" /><path d="M5.5 14h5M8 11.25V14" /></svg>
);
export const Refresh = (p: P) => (
  <svg {...base(p)}><path d="M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 2.5v3h-3" /></svg>
);
export const Fit = (p: P) => (
  <svg {...base(p)}><path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5" /></svg>
);
export const Branch = (p: P) => (
  <svg {...base(p)}><circle cx="4.5" cy="3.5" r="1.5" /><circle cx="4.5" cy="12.5" r="1.5" /><circle cx="11.5" cy="5.5" r="1.5" /><path d="M4.5 5v6M11.5 7c0 2.5-3 2.5-6.2 4.3" /></svg>
);
export const DiffIcon = (p: P) => (
  <svg {...base(p)}><path d="M5 2v6M2 5h6M2 12h6M11 3.5V14M9 12l2 2 2-2" /></svg>
);
export const GraphIcon = (p: P) => (
  <svg {...base(p)}><rect x="1.5" y="6" width="4" height="4" rx="1" /><rect x="10.5" y="2" width="4" height="4" rx="1" /><rect x="10.5" y="10" width="4" height="4" rx="1" /><path d="M5.5 8h2.5V4h2.5M8 8v4h2.5" /></svg>
);
export const Forward = (p: P) => (
  <svg {...base(p)}><path d="M3 8h10M9 4l4 4-4 4" /></svg>
);
export const Copy = (p: P) => (
  <svg {...base(p)}><rect x="5.25" y="5.25" width="8.5" height="8.5" rx="1.5" /><path d="M10.75 5.25V3.5a1.25 1.25 0 00-1.25-1.25h-6A1.25 1.25 0 002.25 3.5v6a1.25 1.25 0 001.25 1.25h1.75" /></svg>
);
export const Send = (p: P) => (
  <svg {...base(p)}><path d="M14 2L7 9M14 2l-4.5 12-2.5-5-5-2.5z" /></svg>
);
export const Comment = (p: P) => (
  <svg {...base(p)}><path d="M2.5 3.5a1.5 1.5 0 011.5-1.5h8a1.5 1.5 0 011.5 1.5v6a1.5 1.5 0 01-1.5 1.5H7l-3 2.5V11H4a1.5 1.5 0 01-1.5-1.5z" /></svg>
);
export const SidebarIcon = (p: P) => (
  <svg {...base(p)}><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" /><path d="M6 2.75v10.5" /></svg>
);
/** A linked worktree: a branch checked out in a separate folder. */
export const WorktreeIcon = (p: P) => (
  <svg {...base(p)}><path d="M4.5 2.5v11M4.5 6.5c0 2 1.5 2.5 4 2.5" /><rect x="9" y="6.75" width="5" height="4.5" rx="1" /></svg>
);
