import { HUES, type LogEvent, type LogState, type Segment } from './types';

export function emptyState(): LogState {
  return { tasks: new Map(), plans: new Map(), segments: [], open: null, parked: null };
}

/** Fold the whole log into the current state. Events must be in time order. */
export function reduce(events: readonly LogEvent[]): LogState {
  const s = emptyState();
  for (const e of events) apply(s, e);
  return s;
}

function close(s: LogState, at: number) {
  if (!s.open) return;
  // A segment never ends before it starts, even if a clock went backwards.
  s.open.end = Math.max(at, s.open.start);
  s.open = null;
}

function openSegment(s: LogState, seg: Segment) {
  s.segments.push(seg);
  s.open = seg;
}

function apply(s: LogState, e: LogEvent) {
  switch (e.type) {
    case 'task.added':
      if (s.tasks.has(e.taskId)) return;
      s.tasks.set(e.taskId, {
        id: e.taskId,
        title: e.title,
        estimateMin: e.estimateMin,
        done: false,
        removed: false,
        createdAt: e.at,
        hue: s.tasks.size % HUES,
      });
      return;
    case 'task.edited': {
      const t = s.tasks.get(e.taskId);
      if (!t) return;
      if (e.title !== undefined) t.title = e.title;
      if (e.estimateMin !== undefined) t.estimateMin = e.estimateMin;
      return;
    }
    case 'task.done': {
      const t = s.tasks.get(e.taskId);
      if (t) t.done = e.done;
      return;
    }
    case 'task.removed': {
      const t = s.tasks.get(e.taskId);
      if (t) t.removed = true;
      return;
    }
    case 'plan.set':
      s.plans.set(e.day, { taskIds: [...e.taskIds], startMin: e.startMin });
      return;
    case 'started':
      if (!s.tasks.has(e.taskId)) return;
      if (s.open?.kind === 'task' && s.open.taskId === e.taskId) return;
      close(s, e.at);
      s.parked = null;
      openSegment(s, { kind: 'task', taskId: e.taskId, start: e.at });
      return;
    case 'stopped':
      close(s, e.at);
      s.parked = null;
      return;
    case 'interruption.started':
      if (s.open?.kind === 'interruption') return;
      s.parked = s.open?.kind === 'task' ? (s.open.taskId ?? null) : null;
      close(s, e.at);
      openSegment(s, { kind: 'interruption', start: e.at });
      return;
    case 'interruption.ended': {
      if (s.open?.kind !== 'interruption') return;
      const back = s.parked;
      close(s, e.at);
      s.parked = null;
      if (back && s.tasks.has(back)) openSegment(s, { kind: 'task', taskId: back, start: e.at });
      return;
    }
  }
}
