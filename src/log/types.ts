// The log is an append-only list of events. Everything on screen is computed
// from it, so a running timer is just "started at T" and survives the app
// being closed.

export type DayKey = string; // local date, "2026-11-18"

type Base = { id: string; at: number };

export type LogEvent =
  | (Base & { type: 'task.added'; taskId: string; title: string; estimateMin: number })
  | (Base & { type: 'task.edited'; taskId: string; title?: string; estimateMin?: number })
  /** With `day`, done for that day only: a repeating task is finished again each day. */
  | (Base & { type: 'task.done'; taskId: string; done: boolean; day?: DayKey })
  /** `removed: false` brings a deleted task back. */
  | (Base & { type: 'task.removed'; taskId: string; removed?: boolean })
  | (Base & { type: 'plan.set'; day: DayKey; taskIds: string[]; startMin: number })
  /** What is particular to one task on one day. Only the fields present change. */
  | (Base & { type: 'entry.set'; day: DayKey; taskId: string; lengthMin?: number; pinMin?: number | null; skip?: boolean })
  /** How a task repeats from `from` onward. Earlier days keep the rule they had. */
  | (Base & { type: 'rule.set'; taskId: string; from: DayKey; days: number[]; atMin?: number; lengthMin: number })
  /** Makes a task a project with a total budget of time. */
  | (Base & { type: 'project.set'; taskId: string; budgetMin: number })
  /** `reopen` continues the stretch that was just closed, as if it never stopped. */
  | (Base & { type: 'started'; taskId: string; reopen?: boolean })
  /** `endAt` says the work really ended earlier than this event. */
  | (Base & { type: 'stopped'; endAt?: number })
  /** Shortens a stretch that is already closed. */
  | (Base & { type: 'trimmed'; segStart: number; endAt: number })
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
  /** Days on which a repeating task was finished. */
  doneOn: Set<DayKey>;
};

export type Segment = {
  kind: 'task' | 'interruption';
  taskId?: string;
  start: number;
  end?: number; // undefined while running
};

export type Plan = { taskIds: string[]; startMin: number };

export type Override = { lengthMin?: number; pinMin?: number | null; skip?: boolean };

/** `days` are weekdays as Date.getDay() gives them: 0 is Sunday. */
export type RuleVersion = { from: DayKey; days: number[]; atMin?: number; lengthMin: number };

export type Project = { taskId: string; budgetMin: number };

export type LogState = {
  tasks: Map<string, Task>;
  plans: Map<DayKey, Plan>;
  /** Per day, per task: a length, a pinned time or a skipped occurrence. */
  overrides: Map<DayKey, Map<string, Override>>;
  /** Per task, the versions of its repeat rule, oldest first. */
  rules: Map<string, RuleVersion[]>;
  projects: Map<string, Project>;
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
