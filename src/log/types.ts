// The log is an append-only list of events. Everything on screen is computed
// from it, so a running timer is just "started at T" and survives the app
// being closed.

export type DayKey = string; // local date, "2026-11-18"

type Base = { id: string; at: number };

export type LogEvent =
  | (Base & { type: 'task.added'; taskId: string; title: string; estimateMin: number })
  | (Base & { type: 'task.edited'; taskId: string; title?: string; estimateMin?: number })
  | (Base & { type: 'task.done'; taskId: string; done: boolean })
  | (Base & { type: 'task.removed'; taskId: string })
  | (Base & { type: 'plan.set'; day: DayKey; taskIds: string[]; startMin: number })
  | (Base & { type: 'started'; taskId: string })
  | (Base & { type: 'stopped' })
  | (Base & { type: 'interruption.started' })
  | (Base & { type: 'interruption.ended' });

export type Task = {
  id: string;
  title: string;
  estimateMin: number;
  done: boolean;
  removed: boolean;
  createdAt: number;
  hue: number; // index into the task colour set
};

export type Segment = {
  kind: 'task' | 'interruption';
  taskId?: string;
  start: number;
  end?: number; // undefined while running
};

export type Plan = { taskIds: string[]; startMin: number };

export type LogState = {
  tasks: Map<string, Task>;
  plans: Map<DayKey, Plan>;
  segments: Segment[];
  /** The segment still running, if any. Always the last one. */
  open: Segment | null;
  /** Task set aside by the interruption in progress. */
  parked: string | null;
};

export const HUES = 8;

/** Planned lengths, in minutes. */
export const MIN_LEN = 5;
export const LEN_STEP = 5;
export const MAX_LEN = 480;
