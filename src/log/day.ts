import type { DayKey, LogState, Plan, Segment, Task } from './types';

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
    out.push({
      kind: seg.kind,
      taskId: seg.taskId,
      start,
      end,
      running: seg.end === undefined,
      startMin: (start - from) / 60000,
      endMin: (end - from) / 60000,
      wholeMs: segEnd - seg.start,
    });
  }
  return out;
}

export type PlanBlock = { task: Task; startMin: number; endMin: number };

/** Lay the planned tasks end to end from the plan's start time. */
export function layoutPlan(state: LogState, plan: Plan | undefined): PlanBlock[] {
  if (!plan) return [];
  const blocks: PlanBlock[] = [];
  let at = plan.startMin;
  for (const id of plan.taskIds) {
    const task = state.tasks.get(id);
    if (!task || task.removed) continue;
    blocks.push({ task, startMin: at, endMin: at + task.estimateMin });
    at += task.estimateMin;
  }
  return blocks;
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
