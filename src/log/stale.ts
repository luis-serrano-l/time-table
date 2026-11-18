import type { LogState } from './types';

const MIN = 60000;

/** Away this long with a timer running, and the app asks. */
export const GAP_MIN = 60;

export type Snooze = { segStart: number; until: number; count: number };

export type Stale = {
  /** 'gap': the app was not open for a long while. 'overrun': far past the planned length. */
  reason: 'gap' | 'overrun';
  segStart: number;
  /** A fair guess at when the work really ended. */
  suggestedEnd: number;
};

type Options = {
  /** When the app was last seen alive before a long absence, if there was one. */
  gap?: { segStart: number; lastSeen: number };
  snooze?: Snooze | null;
  /** The running task's planned length today, and what is logged on it today. */
  plannedMin?: number;
  loggedMs?: number;
};

/** How far past its planned length a task runs before the app asks: half again, between 20 and 60 minutes. */
export const overrunAllowance = (plannedMin: number) => Math.max(20, Math.min(60, plannedMin / 2));

/**
 * Has the running timer probably been forgotten? The app never stops a timer
 * by itself: this only decides whether to ask.
 */
export function staleTimer(state: LogState, now: number, o: Options): Stale | null {
  const open = state.open;
  if (!open) return null;
  if (o.snooze && o.snooze.segStart === open.start && now < o.snooze.until) return null;

  if (o.gap && o.gap.segStart === open.start) {
    return { reason: 'gap', segStart: open.start, suggestedEnd: Math.max(open.start, o.gap.lastSeen) };
  }

  if (open.kind === 'task' && o.plannedMin !== undefined && o.loggedMs !== undefined) {
    const over = o.loggedMs - o.plannedMin * MIN;
    if (over >= overrunAllowance(o.plannedMin) * MIN) {
      return { reason: 'overrun', segStart: open.start, suggestedEnd: Math.max(open.start, now - over) };
    }
  }
  return null;
}

/** Each "still working" buys a longer quiet: 30 minutes, then 60, then 120. */
export function snoozeFor(segStart: number, now: number, prev: Snooze | null | undefined): Snooze {
  const count = prev && prev.segStart === segStart ? prev.count + 1 : 1;
  return { segStart, until: now + Math.min(120, 30 * 2 ** (count - 1)) * MIN, count };
}
