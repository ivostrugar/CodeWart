import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Where a floating panel goes, next to `anchor`, in window coordinates.
 * Rendered into <body>, so panes with `overflow: hidden` can't clip it.
 */
export function useAnchored(anchor: () => HTMLElement | null, open: boolean, align: "left" | "right", up: boolean, gap = 6) {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }
    const place = () => {
      const el = anchor();
      if (!el) return;
      const r = el.getBoundingClientRect();
      const W = window.innerWidth, H = window.innerHeight;
      setStyle({
        position: "fixed",
        ...(align === "left" ? { left: Math.max(8, r.left) } : { right: Math.max(8, W - r.right) }),
        ...(up
          ? { bottom: H - r.top + gap, maxHeight: Math.min(H * 0.6, Math.max(120, r.top - gap - 12)) }
          : { top: r.bottom + gap, maxHeight: Math.min(H * 0.6, Math.max(120, H - r.bottom - gap - 12)) }),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, align, up, gap]);
  return style;
}

/** Anchored popover (to its parent element) that closes on outside click or Escape. */
export function Popover({
  open,
  onClose,
  children,
  align = "left",
  up = false,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: "left" | "right";
  up?: boolean;
}) {
  const mark = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const style = useAnchored(() => mark.current?.parentElement ?? null, open, align, up);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      const parent = mark.current?.parentElement;
      if (parent?.contains(t) || pop.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  return (
    <>
      <span ref={mark} hidden />
      {open &&
        style &&
        createPortal(
          <div ref={pop} className="pop" style={style}>
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
