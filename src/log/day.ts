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

export type DaySegment = {
  id: string;
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
      id: seg.id,
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
  // Entries can be corrected or written in by hand, so the log is not always in order.
  return out.sort((a, b) => a.start - b.start);
}

/** A clock time on a day, as a moment. Follows the wall clock across daylight saving. */
export function atMinute(key: DayKey, min: number): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, Math.floor(min / 60), min % 60).getTime();
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

/** A project, or a task that has ever repeated: it is finished a day at a time. */
export function isRepeating(state: LogState, taskId: string): boolean {
  return state.projects.has(taskId) || state.rules.has(taskId);
}

/** One task on one day. */
export type DayEntry = {
  task: Task;
  done: boolean;
  /** Here because its repeat rule says so. */
  ruled: boolean;
  /** Named in the day's own list. */
  listed: boolean;
  /** Left unfinished on this earlier day, so it came along to today. */
  carriedFrom?: DayKey;
};

/** The last day whose list names each task; with `before`, the last one earlier than that day. */
function lastListed(state: LogState, before?: DayKey): Map<string, DayKey> {
  const last = new Map<string, DayKey>();
  for (const [day, plan] of state.plans) {
    if (before !== undefined && day >= before) continue;
    for (const id of plan.taskIds) if ((last.get(id) ?? '') < day) last.set(id, day);
  }
  return last;
}

/**
 * What is on a day: the tasks its list names, in that order, then the tasks
 * whose repeat rule falls on that weekday. Today also gets the one-off tasks
 * left unfinished on an earlier day. Nothing is written when a day is opened,
 * so two devices never both add the same occurrence.
 */
export function resolveDay(state: LogState, day: DayKey, today: DayKey): DayEntry[] {
  const plan = state.plans.get(day);
  const over = state.overrides.get(day);
  const wd = weekday(day);
  const entries: DayEntry[] = [];
  const seen = new Set<string>();

  const entry = (task: Task, listed: boolean): DayEntry => ({
    task,
    done: task.done || task.doneOn.has(day),
    ruled: !!ruleFor(state, task.id, day)?.days.includes(wd),
    listed,
  });

  // A one-off task that was on an earlier day too keeps saying where it came
  // from, also once today's own list names it (adding or dragging does that).
  const earlier = plan ? lastListed(state, day) : undefined;
  for (const id of plan?.taskIds ?? []) {
    const task = state.tasks.get(id);
    if (!task || task.removed || seen.has(id)) continue;
    seen.add(id);
    const e = entry(task, true);
    const from = earlier!.get(id);
    if (from && !isRepeating(state, id)) e.carriedFrom = from;
    entries.push(e);
  }

  const derived: DayEntry[] = [];
  for (const id of state.rules.keys()) {
    const task = state.tasks.get(id);
    if (!task || task.removed || seen.has(id) || over?.get(id)?.skip) continue;
    const e = entry(task, false);
    if (e.ruled) derived.push(e);
  }
  derived.sort((a, b) => a.task.createdAt - b.task.createdAt || (a.task.id < b.task.id ? -1 : 1));

  const carried: DayEntry[] = [];
  if (day === today) {
    for (const [id, from] of lastListed(state)) {
      const task = state.tasks.get(id);
      if (!task || task.removed || seen.has(id) || from >= today || isRepeating(state, id)) continue;
      // Finished on an earlier day: it stays there. Finished today: it shows as done today.
      if (task.done && (task.doneAt === undefined || dayKey(task.doneAt) !== today)) continue;
      if (takenOff(state, id, from, today)) continue;
      carried.push({ ...entry(task, false), carriedFrom: from });
    }
    // Oldest day first, and within a day the order they had on it.
    const place = (e: DayEntry) => state.plans.get(e.carriedFrom!)!.taskIds.indexOf(e.task.id);
    carried.sort((a, b) => (a.carriedFrom! < b.carriedFrom! ? -1 : a.carriedFrom! > b.carriedFrom! ? 1 : place(a) - place(b)));
  }

  return [...entries, ...derived, ...carried];
}

/** Was a carried task taken off some day after the one it was last listed on? */
function takenOff(state: LogState, taskId: string, from: DayKey, today: DayKey): boolean {
  for (const [day, over] of state.overrides) {
    if (day > from && day <= today && over.get(taskId)?.skip) return true;
  }
  return false;
}

/** Tasks that are on no day at all and not finished: somewhere to find them again. */
export function looseTasks(state: LogState, today: DayKey): Task[] {
  const listed = lastListed(state);
  const out: Task[] = [];
  for (const task of state.tasks.values()) {
    if (task.removed || task.done || isRepeating(state, task.id)) continue;
    const from = listed.get(task.id);
    if (from === undefined || (from < today && takenOff(state, task.id, from, today))) out.push(task);
  }
  return out;
}

/**
 * Times are typed to the minute and logged to the millisecond. An edge that
 * lands less than a minute inside a neighbour is meant to touch it.
 */
export function snapEntry(
  state: LogState,
  segId: string | null,
  start: number,
  end: number | undefined,
): { start: number; end: number | undefined } {
  for (const seg of state.segments) {
    if (seg.id === segId) continue;
    if (seg.end !== undefined && start < seg.end && seg.end - start < 60000) start = seg.end;
    if (end !== undefined && end > seg.start && end - seg.start < 60000) end = seg.start;
  }
  return { start, end };
}

export type EntryProblem = { kind: 'empty' | 'future' } | { kind: 'overlap'; with: Segment };

/**
 * Can a logged stretch run from `start` to `end`? `segId` is the one being
 * corrected, or null for a new one. An open stretch has no end to check.
 */
export function checkEntry(
  state: LogState,
  segId: string | null,
  start: number,
  end: number | undefined,
  now: number,
): EntryProblem | null {
  if (start > now || (end !== undefined && end > now)) return { kind: 'future' };
  if (end !== undefined && end <= start) return { kind: 'empty' };
  const until = end ?? now;
  for (const seg of state.segments) {
    if (seg.id === segId) continue;
    if (start < (seg.end ?? now) && seg.start < until) return { kind: 'overlap', with: seg };
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
