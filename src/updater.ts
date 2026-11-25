/// <reference types="vite/client" />
import { useCallback, useEffect, useRef, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { errorMessage } from "./api";

/** A newer release is available; `progress` is set while it installs (0–100). */
export interface UpdateState {
  version: string;
  progress: number | null;
}

const FIRST_CHECK_MS = 5_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Looks for a newer release on GitHub shortly after start and every few
 * hours. `install` downloads it (signature-checked by the updater plugin),
 * installs it and restarts the app.
 */
export function useUpdater(toast: (msg: string, err?: boolean) => void) {
  const [state, setState] = useState<UpdateState | null>(null);
  const update = useRef<Update | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    let live = true;
    const look = async () => {
      if (busy.current) return;
      try {
        const u = await check();
        if (!live || !u || busy.current) return;
        update.current = u;
        setState({ version: u.version, progress: null });
      } catch {
        // Offline, rate-limited or no release yet: try again later.
      }
    };
    const first = window.setTimeout(look, FIRST_CHECK_MS);
    const every = window.setInterval(look, CHECK_EVERY_MS);
    return () => {
      live = false;
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, []);

  const install = useCallback(async () => {
    const u = update.current;
    if (!u || busy.current) return;
    busy.current = true;
    let total = 0;
    let got = 0;
    setState({ version: u.version, progress: 0 });
    try {
      await u.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        else if (e.event === "Progress") {
          got += e.data.chunkLength;
          if (total) setState({ version: u.version, progress: Math.min(100, Math.round((got / total) * 100)) });
        } else setState({ version: u.version, progress: 100 });
      });
      await relaunch();
    } catch (e) {
      busy.current = false;
      setState({ version: u.version, progress: null });
      toast(`Update failed: ${errorMessage(e)}`, true);
    }
  }, [toast]);

  return { update: state, installUpdate: install };
}
