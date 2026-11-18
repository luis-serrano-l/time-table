import { useEffect, useRef, useState } from 'react';
import { GAP_MIN, snoozeFor, staleTimer, type Snooze, type Stale } from '../log/stale';
import type { LogState } from '../log/types';
import { readLocal, writeLocal } from '../store/local';

type Gap = { segStart: number; lastSeen: number };

/**
 * Watches for a timer that was probably forgotten: one far past its planned
 * length, or one still running when the app comes back after a long absence.
 */
export function useStale(
  state: LogState,
  now: number,
  ready: boolean,
  plannedMin: number | undefined,
  loggedMs: number | undefined,
): { stale: Stale | null; stillWorking: () => void } {
  const [gap, setGap] = useState<Gap | null>(null);
  const [snooze, setSnooze] = useState<Snooze | null>(() => readLocal<Snooze>('snooze'));
  const seen = useRef<number | null>(null);
  const saved = useRef(0);
  const openStart = state.open?.start;

  // "Last seen" is the previous tick, or what the app wrote down before it was closed.
  useEffect(() => {
    if (!ready) return;
    const last = seen.current ?? readLocal<number>('seen') ?? now;
    if (openStart !== undefined && now - last >= GAP_MIN * 60000) {
      setGap({ segStart: openStart, lastSeen: last });
    }
    seen.current = now;
    if (now - saved.current >= 30000) {
      saved.current = now;
      writeLocal('seen', now);
    }
  }, [now, ready, openStart]);

  useEffect(() => {
    const save = () => seen.current !== null && writeLocal('seen', seen.current);
    window.addEventListener('pagehide', save);
    return () => window.removeEventListener('pagehide', save);
  }, []);

  const stale = ready ? staleTimer(state, now, { gap: gap ?? undefined, snooze, plannedMin, loggedMs }) : null;

  return {
    stale,
    stillWorking() {
      if (!stale) return;
      const next = snoozeFor(stale.segStart, now, snooze);
      setSnooze(next);
      writeLocal('snooze', next);
      setGap(null);
    },
  };
}
