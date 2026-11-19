import { HUES, type LogEvent, type LogState, type RuleVersion, type Segment } from './types';

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** While replaying, the reducer also remembers the stretch that was closed last. */
type Working = LogState & { closed?: Segment };

export function emptyState(): LogState {
  return {
    tasks: new Map(),
    plans: new Map(),
    overrides: new Map(),
    rules: new Map(),
    projects: new Map(),
    segments: [],
    bin: new Map(),
    open: null,
    parked: null,
  };
}

/** Fold the whole log into the current state. Events must be in time order. */
export function reduce(events: readonly LogEvent[]): LogState {
  const s: Working = emptyState();
  for (const e of events) apply(s, e);
  delete s.closed;
  return s;
}

function close(s: Working, at: number) {
  if (!s.open) return;
  // A segment never ends before it starts, even if a clock went backwards.
  s.open.end = Math.max(at, s.open.start);
  s.closed = s.open;
  s.open = null;
}

function openSegment(s: LogState, seg: Segment) {
  s.segments.push(seg);
  s.open = seg;
}

function apply(s: Working, e: LogEvent) {
  switch (e.type) {
    case 'task.added':
      if (s.tasks.has(e.taskId)) return;
      s.tasks.set(e.taskId, {
        id: e.taskId,
        title: e.title,
        estimateMin: num(e.estimateMin) && e.estimateMin > 0 ? e.estimateMin : null,
        focus: e.focus === true,
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
      if (e.estimateMin === null) t.estimateMin = null;
      else if (num(e.estimateMin) && e.estimateMin > 0) t.estimateMin = e.estimateMin;
      if (typeof e.focus === 'boolean') t.focus = e.focus;
      return;
    }
    case 'task.done': {
      const t = s.tasks.get(e.taskId);
      if (!t) return;
      if (e.day === undefined) {
        t.done = e.done;
        t.doneAt = e.done ? e.at : undefined;
      } else if (e.done) t.doneOn.add(e.day);
      else t.doneOn.delete(e.day);
      return;
    }
    case 'task.removed': {
      const t = s.tasks.get(e.taskId);
      if (t) t.removed = e.removed !== false;
      return;
    }
    case 'plan.set':
      if (Array.isArray(e.taskIds)) s.plans.set(e.day, { taskIds: [...e.taskIds] });
      return;
    case 'entry.set': {
      if (!s.tasks.has(e.taskId)) return;
      let day = s.overrides.get(e.day);
      if (!day) s.overrides.set(e.day, (day = new Map()));
      const o = { ...day.get(e.taskId) };
      if (typeof e.skip === 'boolean') o.skip = e.skip;
      day.set(e.taskId, o);
      return;
    }
    case 'rule.set': {
      if (!s.tasks.has(e.taskId) || !Array.isArray(e.days)) return;
      const earlier = (s.rules.get(e.taskId) ?? []).filter((v) => v.from < e.from);
      const version: RuleVersion = { from: e.from, days: [...e.days] };
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
    case 'seg.edited': {
      const binned = s.bin.get(e.segId);
      if (binned) {
        if (e.removed !== false) return;
        s.bin.delete(e.segId);
        s.segments.push(binned);
        return;
      }
      const seg = s.segments.find((x) => x.id === e.segId);
      if (!seg) return;
      if (e.removed) {
        // The running stretch is stopped, not deleted.
        if (seg === s.open) return;
        s.segments.splice(s.segments.indexOf(seg), 1);
        s.bin.set(seg.id, seg);
        return;
      }
      // An edit never reaches past the moment it was made, and never turns a stretch inside out.
      const start = Math.min(num(e.start) ? e.start : seg.start, e.at);
      const end = seg.end !== undefined && num(e.end) ? Math.min(e.end, e.at) : seg.end;
      if (end !== undefined && end <= start) return;
      seg.start = start;
      seg.end = end;
      return;
    }
    case 'seg.added': {
      if (!s.tasks.has(e.taskId) || !num(e.start) || !num(e.end) || e.end <= e.start) return;
      if (s.bin.has(e.id) || s.segments.some((x) => x.id === e.id)) return;
      const seg: Segment = { id: e.id, kind: 'task', taskId: e.taskId, start: e.start, end: Math.min(e.end, e.at) };
      if (seg.end! <= seg.start) return;
      // The running stretch stays last.
      if (s.open) s.segments.splice(s.segments.indexOf(s.open), 0, seg);
      else s.segments.push(seg);
      return;
    }
    case 'started': {
      if (!s.tasks.has(e.taskId)) return;
      if (s.open?.kind === 'task' && s.open.taskId === e.taskId) return;
      const last = s.closed;
      if (e.reopen && !s.open && last?.kind === 'task' && last.taskId === e.taskId && s.segments.includes(last)) {
        last.end = undefined;
        s.open = last;
        return;
      }
      close(s, e.at);
      s.parked = null;
      openSegment(s, { id: e.id, kind: 'task', taskId: e.taskId, start: e.at });
      return;
    }
    case 'stopped':
      close(s, num(e.endAt) ? Math.min(e.endAt, e.at) : e.at);
      s.parked = null;
      return;
    case 'interruption.started': {
      if (s.open?.kind === 'interruption') return;
      s.parked = s.open?.kind === 'task' ? (s.open.taskId ?? null) : null;
      // It can begin earlier than it was written down, but only inside the task it broke into.
      const from = s.open && num(e.startAt) ? Math.max(s.open.start, Math.min(e.startAt, e.at)) : e.at;
      close(s, from);
      const seg: Segment = { id: e.id, kind: 'interruption', start: from };
      if (e.away === true) seg.away = true;
      openSegment(s, seg);
      return;
    }
    case 'interruption.ended': {
      if (s.open?.kind !== 'interruption') return;
      const back = s.parked;
      close(s, e.at);
      s.parked = null;
      if (back && s.tasks.get(back)?.removed === false) openSegment(s, { id: e.id, kind: 'task', taskId: back, start: e.at });
      return;
    }
  }
}
