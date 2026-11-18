import { HUES, type LogEvent, type LogState, type RuleVersion, type Segment } from './types';

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function emptyState(): LogState {
  return {
    tasks: new Map(),
    plans: new Map(),
    overrides: new Map(),
    rules: new Map(),
    projects: new Map(),
    segments: [],
    open: null,
    parked: null,
  };
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
        doneOn: new Set(),
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
      if (!t) return;
      if (e.day === undefined) t.done = e.done;
      else if (e.done) t.doneOn.add(e.day);
      else t.doneOn.delete(e.day);
      return;
    }
    case 'task.removed': {
      const t = s.tasks.get(e.taskId);
      if (t) t.removed = e.removed !== false;
      return;
    }
    case 'plan.set':
      s.plans.set(e.day, { taskIds: [...e.taskIds], startMin: e.startMin });
      return;
    case 'entry.set': {
      if (!s.tasks.has(e.taskId)) return;
      let day = s.overrides.get(e.day);
      if (!day) s.overrides.set(e.day, (day = new Map()));
      const o = { ...day.get(e.taskId) };
      if (num(e.lengthMin) && e.lengthMin > 0) o.lengthMin = e.lengthMin;
      if (e.pinMin === null || num(e.pinMin)) o.pinMin = e.pinMin;
      if (typeof e.skip === 'boolean') o.skip = e.skip;
      day.set(e.taskId, o);
      return;
    }
    case 'rule.set': {
      if (!s.tasks.has(e.taskId) || !Array.isArray(e.days) || !num(e.lengthMin)) return;
      const earlier = (s.rules.get(e.taskId) ?? []).filter((v) => v.from < e.from);
      const version: RuleVersion = { from: e.from, days: [...e.days], lengthMin: e.lengthMin };
      if (num(e.atMin)) version.atMin = e.atMin;
      s.rules.set(e.taskId, [...earlier, version]);
      return;
    }
    case 'project.set':
      if (!s.tasks.has(e.taskId) || !num(e.budgetMin)) return;
      s.projects.set(e.taskId, { taskId: e.taskId, budgetMin: e.budgetMin });
      return;
    case 'trimmed': {
      const seg = s.segments.find((x) => x.start === e.segStart && x.end !== undefined);
      if (seg && num(e.endAt)) seg.end = Math.min(seg.end!, Math.max(seg.start, e.endAt));
      return;
    }
    case 'started': {
      if (!s.tasks.has(e.taskId)) return;
      if (s.open?.kind === 'task' && s.open.taskId === e.taskId) return;
      const last = s.segments[s.segments.length - 1];
      if (e.reopen && !s.open && last?.kind === 'task' && last.taskId === e.taskId) {
        last.end = undefined;
        s.open = last;
        return;
      }
      close(s, e.at);
      s.parked = null;
      openSegment(s, { kind: 'task', taskId: e.taskId, start: e.at });
      return;
    }
    case 'stopped':
      close(s, num(e.endAt) ? Math.min(e.endAt, e.at) : e.at);
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
      if (back && s.tasks.get(back)?.removed === false) openSegment(s, { kind: 'task', taskId: back, start: e.at });
      return;
    }
  }
}
