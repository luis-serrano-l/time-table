import type { DayKey, LogState, RuleVersion, Segment, Task } from './types';

export const DEEP_MIN = 25; // an unbroken stretch this long counts as deep work

export function dayKey(ms: number): DayKey {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Local midnight to the next local midnight. Not always 24 h (daylight saving). */
export function dayRange(key: DayKey): [number, number] {
  const [y, m, d] = key.split('-').map(Number);
  return [new Date(y, m - 1, d).getTime(), new Date(y, m - 1, d + 1).getTime()];
}

/** Minutes from local midnight on the wall clock, so it matches what a clock shows on any day. */
export function wallMin(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000;
}

/** Where a new plan starts: the next quarter hour. */
export function defaultStartMin(now: number): number {
  return Math.min(23 * 60, Math.ceil(Math.floor(wallMin(now)) / 15) * 15);
}

export type DaySegment = {
  kind: Segment['kind'];
  taskId?: string;
  start: number;
  end: number;
  running: boolean;
  /** Minutes from local midnight, for drawing. */
  startMin: number;
  endMin: number;
  /** Full length of the unbroken stretch, even where it crosses midnight. */
  wholeMs: number;
};

/** The parts of the log that fall inside one day, clipped to it. */
export function daySegments(state: LogState, key: DayKey, now: number): DaySegment[] {
  const [from, to] = dayRange(key);
  const out: DaySegment[] = [];
  for (const seg of state.segments) {
    const segEnd = seg.end ?? Math.max(now, seg.start);
    const start = Math.max(seg.start, from);
    const end = Math.min(segEnd, to);
    if (end <= start && !(seg.end === undefined && start >= from && start < to)) continue;
    const startMin = start === from ? 0 : wallMin(start);
    out.push({
      kind: seg.kind,
      taskId: seg.taskId,
      start,
      end,
      running: seg.end === undefined,
      startMin,
      endMin: Math.max(startMin, end === to ? 24 * 60 : wallMin(end)),
      wholeMs: segEnd - seg.start,
    });
  }
  return out;
}

/** 0 (Sunday) to 6, as Date.getDay() gives it. */
export function weekday(key: DayKey): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** The day `n` days after (or before) `key`. */
export function addDays(key: DayKey, n: number): DayKey {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n).getTime());
}

/** The repeat rule in force for a task on a day, if it had one by then. */
export function ruleFor(state: LogState, taskId: string, day: DayKey): RuleVersion | undefined {
  let found: RuleVersion | undefined;
  for (const v of state.rules.get(taskId) ?? []) if (v.from <= day) found = v;
  return found;
}

/** The rule a task repeats by now, if it still repeats. */
export function activeRule(state: LogState, taskId: string): RuleVersion | undefined {
  const versions = state.rules.get(taskId);
  const last = versions?.[versions.length - 1];
  return last?.days.length ? last : undefined;
}

/** Where a day's plan starts before anyone has set it. */
export function defaultStart(day: DayKey, now: number): number {
  return day === dayKey(now) ? defaultStartMin(now) : 9 * 60;
}

/** A project, or a task that has ever repeated: its length and "done" are per day. */
export function isRepeating(state: LogState, taskId: string): boolean {
  return state.projects.has(taskId) || state.rules.has(taskId);
}

/** One task on one day, before it is given a place on the clock. */
export type DayEntry = {
  task: Task;
  lengthMin: number;
  /** Fixed start, in minutes from midnight. Null: it flows after the task before it. */
  pinMin: number | null;
  done: boolean;
  /** Here because its repeat rule says so. */
  ruled: boolean;
  /** Named in the day's own plan. */
  listed: boolean;
};

export type ResolvedDay = { startMin: number | null; entries: DayEntry[] };

/**
 * What is on a day: the tasks its plan names, in that order, then the tasks
 * whose repeat rule falls on that weekday. Nothing is written when a day is
 * opened, so two devices never both add the same occurrence.
 */
export function resolveDay(state: LogState, day: DayKey): ResolvedDay {
  const plan = state.plans.get(day);
  const over = state.overrides.get(day);
  const wd = weekday(day);
  const entries: DayEntry[] = [];
  const seen = new Set<string>();

  const entry = (task: Task, listed: boolean): DayEntry => {
    const o = over?.get(task.id);
    const rule = ruleFor(state, task.id, day);
    const ruled = !!rule && rule.days.includes(wd);
    return {
      task,
      lengthMin: o?.lengthMin ?? rule?.lengthMin ?? task.estimateMin,
      pinMin: o?.pinMin !== undefined ? o.pinMin : ruled ? (rule.atMin ?? null) : null,
      done: task.done || task.doneOn.has(day),
      ruled,
      listed,
    };
  };

  for (const id of plan?.taskIds ?? []) {
    const task = state.tasks.get(id);
    if (!task || task.removed || seen.has(id)) continue;
    seen.add(id);
    entries.push(entry(task, true));
  }

  const derived: DayEntry[] = [];
  for (const id of state.rules.keys()) {
    const task = state.tasks.get(id);
    if (!task || task.removed || seen.has(id) || over?.get(id)?.skip) continue;
    const e = entry(task, false);
    if (e.ruled) derived.push(e);
  }
  derived.sort(
    (a, b) =>
      (ruleFor(state, a.task.id, day)?.atMin ?? Infinity) - (ruleFor(state, b.task.id, day)?.atMin ?? Infinity) ||
      a.task.createdAt - b.task.createdAt ||
      (a.task.id < b.task.id ? -1 : 1),
  );

  return { startMin: plan?.startMin ?? null, entries: [...entries, ...derived] };
}

export type PlanBlock = {
  task: Task;
  startMin: number;
  endMin: number;
  lengthMin: number;
  pinned: boolean;
  done: boolean;
  /** Pinned at a time that overlaps another pinned task. */
  clash: boolean;
  /** Clashing blocks are drawn side by side. */
  lane: 0 | 1;
  /** Starts after midnight, so it is not on this day at all. */
  offDay: boolean;
};

/**
 * Give every entry a time. Pinned tasks sit where they are pinned. The rest
 * run end to end from `startMin` in list order, and one that would run into a
 * pinned task starts after it instead. Blocks come back in clock order.
 */
export function layoutPlan(entries: readonly DayEntry[], startMin: number): PlanBlock[] {
  const block = (e: DayEntry, at: number): PlanBlock => ({
    task: e.task,
    startMin: at,
    endMin: at + e.lengthMin,
    lengthMin: e.lengthMin,
    pinned: e.pinMin !== null,
    done: e.done,
    clash: false,
    lane: 0,
    offDay: at >= 24 * 60,
  });

  const pinned = entries
    .filter((e) => e.pinMin !== null)
    .map((e) => block(e, e.pinMin!))
    .sort((a, b) => a.startMin - b.startMin);
  const overlap = (a: PlanBlock, b: PlanBlock) => a.startMin < b.endMin && b.startMin < a.endMin;
  pinned.forEach((b, i) => {
    const before = pinned.slice(0, i).filter((a) => overlap(a, b));
    if (!before.length) return;
    b.clash = true;
    before.forEach((a) => (a.clash = true));
    if (before.some((a) => a.lane === 0)) b.lane = 1;
  });

  const flowing: PlanBlock[] = [];
  let at = startMin;
  for (const e of entries) {
    if (e.pinMin !== null) continue;
    for (let hit; (hit = pinned.find((p) => p.startMin < at + e.lengthMin && p.endMin > at)); ) at = hit.endMin;
    flowing.push(block(e, at));
    at += e.lengthMin;
  }

  // Stable: at the same minute, a pinned task comes first.
  return [...pinned, ...flowing].sort((a, b) => a.startMin - b.startMin);
}

export function planDay(state: LogState, day: DayKey, fallbackStart: number): PlanBlock[] {
  const { startMin, entries } = resolveDay(state, day);
  return layoutPlan(entries, startMin ?? fallbackStart);
}

/**
 * Tasks left unfinished on the last day that had a plan, up to a week back,
 * that are not on today yet. Repeating tasks come back by themselves.
 */
export function carryOver(state: LogState, today: DayKey): { from: DayKey; tasks: Task[] } | null {
  for (let i = 1; i <= 7; i++) {
    const from = addDays(today, -i);
    if (!state.plans.has(from)) continue;
    const onToday = new Set(resolveDay(state, today).entries.map((e) => e.task.id));
    const tasks = resolveDay(state, from)
      .entries.filter((e) => e.listed && !e.done && !isRepeating(state, e.task.id) && !onToday.has(e.task.id))
      .map((e) => e.task);
    return tasks.length ? { from, tasks } : null;
  }
  return null;
}

export type DayStats = {
  trackedMs: number;
  interruptedMs: number;
  interruptions: number;
  /** Times you moved from one task straight to a different one. */
  switches: number;
  deepStretches: number;
  perTask: Map<string, number>;
};

export function dayStats(segs: readonly DaySegment[]): DayStats {
  const st: DayStats = {
    trackedMs: 0,
    interruptedMs: 0,
    interruptions: 0,
    switches: 0,
    deepStretches: 0,
    perTask: new Map(),
  };
  let prev: DaySegment | undefined;
  for (const seg of segs) {
    const ms = seg.end - seg.start;
    if (seg.kind === 'interruption') {
      st.interruptions++;
      st.interruptedMs += ms;
    } else if (seg.taskId) {
      st.trackedMs += ms;
      st.perTask.set(seg.taskId, (st.perTask.get(seg.taskId) ?? 0) + ms);
      if (seg.wholeMs >= DEEP_MIN * 60000) st.deepStretches++;
      if (prev?.kind === 'task' && prev.taskId !== seg.taskId && seg.start - prev.end < 60000) {
        st.switches++;
      }
    }
    prev = seg;
  }
  return st;
}
