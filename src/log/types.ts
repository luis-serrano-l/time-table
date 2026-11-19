// The log is an append-only list of events. Everything on screen is computed
// from it, so a running timer is just "started at T" and survives the app
// being closed.

export type DayKey = string; // local date, "2026-11-18"

type Base = { id: string; at: number };

export type LogEvent =
  /** `estimateMin` is optional: a task needs only a name. Null takes an estimate away. */
  | (Base & { type: 'task.added'; taskId: string; title: string; estimateMin?: number; focus?: boolean })
  | (Base & { type: 'task.edited'; taskId: string; title?: string; estimateMin?: number | null; focus?: boolean })
  /** With `day`, done for that day only: a repeating task is finished again each day. */
  | (Base & { type: 'task.done'; taskId: string; done: boolean; day?: DayKey })
  /** `removed: false` brings a deleted task back. */
  | (Base & { type: 'task.removed'; taskId: string; removed?: boolean })
  /**
   * The tasks on a day, in order. Older logs also carry a start time here, and
   * lengths and clock times in the two events below: tasks no longer have a
   * place on the clock, so those are read past.
   */
  | (Base & { type: 'plan.set'; day: DayKey; taskIds: string[]; startMin?: number })
  /** `skip` keeps a repeating or carried-over task off a day. */
  | (Base & { type: 'entry.set'; day: DayKey; taskId: string; lengthMin?: number; pinMin?: number | null; skip?: boolean })
  /** The weekdays a task repeats on from `from` onward. Earlier days keep the rule they had. */
  | (Base & { type: 'rule.set'; taskId: string; from: DayKey; days: number[]; atMin?: number; lengthMin?: number })
  /** Makes a task a project with a total budget of time. */
  | (Base & { type: 'project.set'; taskId: string; budgetMin: number })
  /** `reopen` continues the stretch that was just closed, as if it never stopped. */
  | (Base & { type: 'started'; taskId: string; reopen?: boolean })
  /** `endAt` says the work really ended earlier than this event. */
  | (Base & { type: 'stopped'; endAt?: number })
  /** Shortens a stretch that is already closed. Older logs only: see `seg.edited`. */
  | (Base & { type: 'trimmed'; segStart: number; endAt: number })
  /** Corrects a logged stretch: move its start or end, say what it was, delete it, or bring it back. */
  | (Base & { type: 'seg.edited'; segId: string; start?: number; end?: number; removed?: boolean; note?: string })
  /** A stretch written in by hand, for work that was never timed. Its id is this event's id. */
  | (Base & { type: 'seg.added'; taskId: string; start: number; end: number })
  /**
   * `startAt` says the interruption really began earlier than this event.
   * `away` marks one the app wrote itself, because a focus task was left behind.
   */
  | (Base & { type: 'interruption.started'; startAt?: number; away?: boolean })
  | (Base & { type: 'interruption.ended' });

export type Task = {
  id: string;
  title: string;
  /** How long it is expected to take, if anyone said. */
  estimateMin: number | null;
  /** Fills the screen while it runs, and leaving the app is logged. */
  focus: boolean;
  done: boolean;
  /** When it was finished for good. */
  doneAt?: number;
  removed: boolean;
  createdAt: number;
  hue: number; // index into the task colour set
  /** Days on which a repeating task was finished. */
  doneOn: Set<DayKey>;
};

export type Segment = {
  /** The id of the event that opened it. */
  id: string;
  kind: 'task' | 'interruption';
  taskId?: string;
  start: number;
  end?: number; // undefined while running
  /** An interruption that was the app being left during a focus task. */
  away?: boolean;
  /** What happened, in the person's words. */
  note?: string;
};

export type Plan = { taskIds: string[] };

export type Override = { skip?: boolean };

/** `days` are weekdays as Date.getDay() gives them: 0 is Sunday. */
export type RuleVersion = { from: DayKey; days: number[] };

export type Project = { taskId: string; budgetMin: number };

export type LogState = {
  tasks: Map<string, Task>;
  plans: Map<DayKey, Plan>;
  /** Per day, per task: an occurrence that was taken off. */
  overrides: Map<DayKey, Map<string, Override>>;
  /** Per task, the versions of its repeat rule, oldest first. */
  rules: Map<string, RuleVersion[]>;
  projects: Map<string, Project>;
  segments: Segment[];
  /** Deleted stretches, kept so a delete can be taken back. */
  bin: Map<string, Segment>;
  /** The segment still running, if any. */
  open: Segment | null;
  /** Task set aside by the interruption in progress. */
  parked: string | null;
};

export const HUES = 8;

