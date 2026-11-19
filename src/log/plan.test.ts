import { describe, expect, it } from 'vitest';
import { addDays, checkEntry, dayKey, daySegments, looseTasks, resolveDay, snapEntry, weekday } from './day';
import { reduce } from './reduce';
import type { DayKey, LogEvent } from './types';

const MIN = 60000;
const T0 = new Date(2026, 10, 18, 9, 0).getTime(); // Wednesday 18 Nov 2026, 09:00 local
const DAY = dayKey(T0);
const WED = weekday(DAY);
const YESTERDAY = addDays(DAY, -1);
const TOMORROW = addDays(DAY, 1);
let n = 0;
const ev = <E extends Omit<LogEvent, 'id'>>(e: E) => ({ ...e, id: `p${n++}` }) as LogEvent;
const add = (taskId: string, min = 0) => ev({ type: 'task.added', at: T0 + min, taskId, title: taskId });
const plan = (day: DayKey, taskIds: string[], at = T0) => ev({ type: 'plan.set', at, day, taskIds });
const rule = (taskId: string, from: DayKey, days: number[]) => ev({ type: 'rule.set', at: T0, taskId, from, days });
const skip = (day: DayKey, taskId: string, on = true, at = T0) => ev({ type: 'entry.set', at, day, taskId, skip: on });
const done = (taskId: string, at = T0, day?: DayKey) => ev({ type: 'task.done', at, taskId, done: true, day });
const ids = (s: ReturnType<typeof reduce>, day: DayKey, today = DAY) => resolveDay(s, day, today).map((e) => e.task.id);
const worked = (taskId: string, fromMin: number, toMin: number) => [
  ev({ type: 'started', at: T0 + fromMin * MIN, taskId }),
  ev({ type: 'stopped', at: T0 + toMin * MIN }),
];

describe('reduce', () => {
  it('a task needs only a name, and an estimate can be given and taken away', () => {
    const s = reduce([
      add('a'),
      ev({ type: 'task.added', at: T0, taskId: 'b', title: 'b', estimateMin: 45 }),
      ev({ type: 'task.edited', at: T0 + 1, taskId: 'a', estimateMin: 20 }),
      ev({ type: 'task.edited', at: T0 + 2, taskId: 'b', estimateMin: null }),
    ]);
    expect(s.tasks.get('a')!.estimateMin).toBe(20);
    expect(s.tasks.get('b')!.estimateMin).toBeNull();
  });

  it('reads past the clock times and lengths of an older log', () => {
    const s = reduce([
      add('a'),
      add('b', 1),
      ev({ type: 'plan.set', at: T0, day: DAY, taskIds: ['b'], startMin: 540 }),
      ev({ type: 'rule.set', at: T0, taskId: 'a', from: DAY, days: [WED], atMin: 600, lengthMin: 20 }),
      ev({ type: 'entry.set', at: T0, day: DAY, taskId: 'a', lengthMin: 10, pinMin: 480 }),
    ]);
    expect(ids(s, DAY)).toEqual(['b', 'a']);
    expect(s.rules.get('a')).toEqual([{ from: DAY, days: [WED] }]);
  });

  it('rule.set replaces versions from its start day onward', () => {
    const s = reduce([add('a'), rule('a', DAY, [WED]), rule('a', addDays(DAY, 14), [1]), rule('a', addDays(DAY, 7), [2])]);
    expect(s.rules.get('a')).toEqual([
      { from: DAY, days: [WED] },
      { from: addDays(DAY, 7), days: [2] },
    ]);
  });

  it('day-scoped done leaves other days undone', () => {
    const s = reduce([add('a'), rule('a', DAY, [0, 1, 2, 3, 4, 5, 6]), done('a', T0, DAY)]);
    expect(resolveDay(s, DAY, DAY)[0].done).toBe(true);
    expect(resolveDay(s, TOMORROW, DAY)[0].done).toBe(false);
    expect(s.tasks.get('a')!.done).toBe(false);
  });

  it('a task done for today can be picked up again the same day', () => {
    const s = reduce([
      add('a'),
      rule('a', DAY, [WED]),
      ...worked('a', 0, 20),
      done('a', T0 + 20 * MIN + 1, DAY),
      ev({ type: 'task.done', at: T0 + 60 * MIN, taskId: 'a', done: false, day: DAY }),
      ev({ type: 'started', at: T0 + 60 * MIN + 1, taskId: 'a' }),
    ]);
    expect(resolveDay(s, DAY, DAY)[0].done).toBe(false);
    expect(s.segments).toHaveLength(2);
    // The time in between is not work.
    expect(s.segments[0].end).toBe(T0 + 20 * MIN);
    expect(s.open?.taskId).toBe('a');
    expect(s.open?.start).toBe(T0 + 60 * MIN + 1);
  });

  it('stopped with endAt closes in the past, never before the start', () => {
    const start = ev({ type: 'started', at: T0, taskId: 'a' });
    const early = reduce([add('a'), start, ev({ type: 'stopped', at: T0 + 90 * MIN, endAt: T0 + 40 * MIN })]);
    expect(early.segments[0].end).toBe(T0 + 40 * MIN);
    const tooEarly = reduce([add('a'), start, ev({ type: 'stopped', at: T0 + 90 * MIN, endAt: T0 - MIN })]);
    expect(tooEarly.segments[0].end).toBe(T0);
    const late = reduce([add('a'), start, ev({ type: 'stopped', at: T0 + 90 * MIN, endAt: T0 + 200 * MIN })]);
    expect(late.segments[0].end).toBe(T0 + 90 * MIN);
  });

  it('trimmed, from older logs, only shortens a closed segment', () => {
    const base = [add('a'), ...worked('a', 0, 60)];
    const cut = reduce([...base, ev({ type: 'trimmed', at: T0 + 61 * MIN, segStart: T0, endAt: T0 + 20 * MIN })]);
    expect(cut.segments[0].end).toBe(T0 + 20 * MIN);
    const grown = reduce([...base, ev({ type: 'trimmed', at: T0 + 61 * MIN, segStart: T0, endAt: T0 + 99 * MIN })]);
    expect(grown.segments[0].end).toBe(T0 + 60 * MIN);
  });

  it('reopen continues the last segment', () => {
    const s = reduce([add('a'), ...worked('a', 0, 30), ev({ type: 'started', at: T0 + 31 * MIN, taskId: 'a', reopen: true })]);
    expect(s.segments).toHaveLength(1);
    expect(s.open).toBe(s.segments[0]);
    expect(s.segments[0].end).toBeUndefined();
  });

  it('restores a removed task', () => {
    const s = reduce([
      add('a'),
      ev({ type: 'task.removed', at: T0, taskId: 'a' }),
      ev({ type: 'task.removed', at: T0 + 1, taskId: 'a', removed: false }),
    ]);
    expect(s.tasks.get('a')!.removed).toBe(false);
  });

  it('does not resume a removed parked task', () => {
    const s = reduce([
      add('a'),
      ev({ type: 'started', at: T0, taskId: 'a' }),
      ev({ type: 'interruption.started', at: T0 + MIN }),
      ev({ type: 'task.removed', at: T0 + 2 * MIN, taskId: 'a' }),
      ev({ type: 'interruption.ended', at: T0 + 3 * MIN }),
    ]);
    expect(s.open).toBeNull();
  });
});

describe('correcting the log', () => {
  const base = () => [add('a'), add('b', 1), ...worked('a', 0, 30), ...worked('b', 40, 60)];
  const LATER = T0 + 120 * MIN;

  it('moves either edge of a closed stretch', () => {
    const events = base();
    const s0 = reduce(events);
    const [a, b] = s0.segments;
    const s = reduce([
      ...events,
      ev({ type: 'seg.edited', at: LATER, segId: a.id, end: T0 + 20 * MIN }),
      ev({ type: 'seg.edited', at: LATER + 1, segId: b.id, start: T0 + 25 * MIN, end: T0 + 70 * MIN }),
    ]);
    expect(s.segments.map((x) => [x.start - T0, x.end! - T0])).toEqual([
      [0, 20 * MIN],
      [25 * MIN, 70 * MIN],
    ]);
  });

  it('moves a whole stretch later in one go', () => {
    const events = base();
    const a = reduce(events).segments[0];
    const s = reduce([...events, ev({ type: 'seg.edited', at: LATER, segId: a.id, start: T0 + 70 * MIN, end: T0 + 100 * MIN })]);
    expect([s.segments[0].start - T0, s.segments[0].end! - T0]).toEqual([70 * MIN, 100 * MIN]);
  });

  it('refuses a stretch turned inside out, and one that reaches past the edit', () => {
    const events = base();
    const a = reduce(events).segments[0];
    const inside = reduce([...events, ev({ type: 'seg.edited', at: LATER, segId: a.id, end: T0 - MIN })]);
    expect(inside.segments[0].end).toBe(T0 + 30 * MIN);
    const ahead = reduce([...events, ev({ type: 'seg.edited', at: LATER, segId: a.id, end: LATER + 60 * MIN })]);
    expect(ahead.segments[0].end).toBe(LATER);
  });

  it('moves the start of the running stretch but never gives it an end', () => {
    const events = [add('a'), ev({ type: 'started', at: T0, taskId: 'a' })];
    const id = reduce(events).open!.id;
    const s = reduce([...events, ev({ type: 'seg.edited', at: T0 + 30 * MIN, segId: id, start: T0 - 10 * MIN, end: T0 + 5 * MIN })]);
    expect(s.open!.start).toBe(T0 - 10 * MIN);
    expect(s.open!.end).toBeUndefined();
  });

  it('deletes a stretch and brings it back', () => {
    const events = base();
    const a = reduce(events).segments[0];
    const gone = [...events, ev({ type: 'seg.edited', at: LATER, segId: a.id, removed: true })];
    expect(reduce(gone).segments.map((x) => x.taskId)).toEqual(['b']);
    const back = reduce([...gone, ev({ type: 'seg.edited', at: LATER + 1, segId: a.id, removed: false })]);
    expect(daySegments(back, DAY, LATER + 2).map((x) => x.taskId)).toEqual(['a', 'b']);
  });

  it('does not delete the stretch that is running', () => {
    const events = [add('a'), ev({ type: 'started', at: T0, taskId: 'a' })];
    const id = reduce(events).open!.id;
    const s = reduce([...events, ev({ type: 'seg.edited', at: T0 + MIN, segId: id, removed: true })]);
    expect(s.open).not.toBeNull();
  });

  it('writes in a stretch by hand, and the day shows it in clock order', () => {
    const events = [...base(), ev({ type: 'started', at: T0 + 90 * MIN, taskId: 'a' })];
    const s = reduce([...events, ev({ type: 'seg.added', at: LATER, taskId: 'b', start: T0 + 30 * MIN, end: T0 + 40 * MIN })]);
    expect(daySegments(s, DAY, LATER + 1).map((x) => [x.taskId, (x.start - T0) / MIN])).toEqual([
      ['a', 0],
      ['b', 30],
      ['b', 40],
      ['a', 90],
    ]);
    expect(s.segments.at(-1)).toBe(s.open);
  });

  it('ignores a hand-made stretch for an unknown task or with no length', () => {
    const s = reduce([
      add('a'),
      ev({ type: 'seg.added', at: LATER, taskId: 'x', start: T0, end: T0 + MIN }),
      ev({ type: 'seg.added', at: LATER, taskId: 'a', start: T0 + MIN, end: T0 }),
    ]);
    expect(s.segments).toEqual([]);
  });

  it('checks a range before it is written', () => {
    const s = reduce(base());
    const a = s.segments[0];
    const now = LATER;
    expect(checkEntry(s, null, T0 + 30 * MIN, T0 + 40 * MIN, now)).toBeNull();
    expect(checkEntry(s, a.id, T0, T0 + 40 * MIN, now)).toBeNull();
    expect(checkEntry(s, a.id, T0, T0 + 41 * MIN, now)).toEqual({ kind: 'overlap', with: s.segments[1] });
    expect(checkEntry(s, null, T0 + 10 * MIN, T0 + 10 * MIN, now)).toEqual({ kind: 'empty' });
    expect(checkEntry(s, null, now, now + MIN, now)).toEqual({ kind: 'future' });
  });

  it('a new range may not run into the stretch still running', () => {
    const s = reduce([add('a'), ev({ type: 'started', at: T0, taskId: 'a' })]);
    expect(checkEntry(s, null, T0 - 10 * MIN, T0 + MIN, T0 + 30 * MIN)?.kind).toBe('overlap');
    expect(checkEntry(s, null, T0 - 10 * MIN, T0, T0 + 30 * MIN)).toBeNull();
  });

  it('an edge typed to the minute touches a neighbour logged to the second', () => {
    const s = reduce([add('a'), ...worked('a', 0, 30.5), ...worked('a', 45.25, 60)]);
    expect(snapEntry(s, null, T0 + 30 * MIN, T0 + 46 * MIN)).toEqual({ start: T0 + 30.5 * MIN, end: T0 + 45.25 * MIN });
    expect(snapEntry(s, null, T0 + 32 * MIN, T0 + 44 * MIN)).toEqual({ start: T0 + 32 * MIN, end: T0 + 44 * MIN });
  });
});

describe('repeating tasks', () => {
  it('a rule adds an occurrence on its weekdays only', () => {
    const s = reduce([add('a'), rule('a', DAY, [WED])]);
    expect(ids(s, DAY)).toEqual(['a']);
    expect(ids(s, TOMORROW)).toEqual([]);
    expect(ids(s, addDays(DAY, 7))).toEqual(['a']);
    expect(ids(s, addDays(DAY, -7))).toEqual([]);
  });

  it('skip removes one occurrence', () => {
    const s = reduce([add('a'), rule('a', DAY, [WED]), skip(DAY, 'a')]);
    expect(ids(s, DAY)).toEqual([]);
    expect(ids(s, addDays(DAY, 7))).toEqual(['a']);
  });

  it('an explicit listing wins over skip', () => {
    const s = reduce([add('a'), rule('a', DAY, [WED]), skip(DAY, 'a'), plan(DAY, ['a'])]);
    expect(ids(s, DAY)).toEqual(['a']);
  });

  it('editing a rule leaves earlier days alone', () => {
    const later = addDays(DAY, 7);
    const s = reduce([add('a'), rule('a', DAY, [WED]), rule('a', later, [(WED + 1) % 7])]);
    expect(ids(s, DAY)).toEqual(['a']);
    expect(ids(s, later)).toEqual([]);
    expect(ids(s, addDays(later, 1))).toEqual(['a']);
  });

  it('ending a rule keeps past occurrences', () => {
    const s = reduce([add('a'), rule('a', DAY, [WED]), rule('a', TOMORROW, [])]);
    expect(ids(s, DAY)).toEqual(['a']);
    expect(ids(s, addDays(DAY, 7))).toEqual([]);
  });

  it('come after the tasks the day names, oldest first', () => {
    const s = reduce([add('a'), add('b', 1), add('c', 2), rule('b', DAY, [WED]), rule('a', DAY, [WED]), plan(DAY, ['c'])]);
    expect(ids(s, DAY)).toEqual(['c', 'a', 'b']);
  });

  it('two devices opening the same day yield one occurrence after a merge', () => {
    // Opening a day writes nothing, so each device only has its own real changes.
    const shared = [add('a'), add('b', 1), rule('a', DAY, [WED])];
    const one = [...shared, plan(DAY, ['b'])];
    const two = [...shared, done('a', T0 + 5, DAY)];
    const byId = new Map([...one, ...two].map((e) => [e.id, e]));
    const merged = [...byId.values()].sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1));
    expect(ids(reduce(merged), DAY)).toEqual(['b', 'a']);
  });
});

describe('unfinished tasks come along to today', () => {
  it('a one-off task left unfinished shows on today, and says where from', () => {
    const s = reduce([add('a'), add('b', 1), plan(YESTERDAY, ['a', 'b']), done('a', T0 - 600 * MIN)]);
    const today = resolveDay(s, DAY, DAY);
    expect(today.map((e) => [e.task.id, e.carriedFrom])).toEqual([['b', YESTERDAY]]);
    expect(ids(s, YESTERDAY)).toEqual(['a', 'b']);
  });

  it('only today gets them: not a day to come, nor the days in between', () => {
    const s = reduce([add('a'), plan(addDays(DAY, -3), ['a'])]);
    expect(ids(s, DAY)).toEqual(['a']);
    expect(ids(s, TOMORROW)).toEqual([]);
    expect(ids(s, YESTERDAY)).toEqual([]);
  });

  it('skips repeating and removed tasks, and ones already on today or on a day to come', () => {
    const s = reduce([
      add('a'),
      add('b', 1),
      add('c', 2),
      add('d', 3),
      add('e', 4),
      rule('a', YESTERDAY, [0, 1, 2, 3, 4, 5, 6]),
      ev({ type: 'task.removed', at: T0, taskId: 'b' }),
      plan(YESTERDAY, ['a', 'b', 'c', 'd', 'e']),
      plan(DAY, ['c']),
      plan(TOMORROW, ['e']),
    ]);
    // c is on today's own list, a repeats, d came along; all but a were on yesterday first.
    expect(resolveDay(s, DAY, DAY).map((e) => [e.task.id, e.listed, e.carriedFrom])).toEqual([
      ['c', true, YESTERDAY],
      ['a', false, undefined],
      ['d', false, YESTERDAY],
    ]);
  });

  it('finished today, it stays on today as done; tomorrow it is gone', () => {
    const s = reduce([add('a'), plan(YESTERDAY, ['a']), done('a', T0 + 5 * MIN)]);
    expect(resolveDay(s, DAY, DAY).map((e) => [e.task.id, e.done])).toEqual([['a', true]]);
    expect(ids(s, TOMORROW, TOMORROW)).toEqual([]);
  });

  it('taken off today, it does not come back tomorrow, and the past day is untouched', () => {
    const s = reduce([add('a'), plan(YESTERDAY, ['a']), skip(DAY, 'a')]);
    expect(ids(s, DAY)).toEqual([]);
    expect(ids(s, TOMORROW, TOMORROW)).toEqual([]);
    expect(ids(s, YESTERDAY)).toEqual(['a']);
    expect(looseTasks(s, DAY).map((t) => t.id)).toEqual(['a']);
  });

  it('taken off and put back, it is carried again', () => {
    const s = reduce([add('a'), plan(YESTERDAY, ['a']), skip(DAY, 'a'), skip(DAY, 'a', false, T0 + 1)]);
    expect(ids(s, DAY)).toEqual(['a']);
  });

  it('reordering today writes it into today: it keeps saying where it came from, and moves on from today', () => {
    const s = reduce([add('a'), add('b', 1), plan(YESTERDAY, ['a']), plan(DAY, ['b', 'a'], T0 + 1)]);
    expect(resolveDay(s, DAY, DAY).map((e) => [e.task.id, e.carriedFrom])).toEqual([
      ['b', undefined],
      ['a', YESTERDAY],
    ]);
    expect(resolveDay(s, TOMORROW, TOMORROW).map((e) => [e.task.id, e.carriedFrom])).toEqual([
      ['b', DAY],
      ['a', DAY],
    ]);
  });

  it('a task taken off the only day it was on is loose, not lost', () => {
    const s = reduce([add('a'), plan(DAY, ['a']), plan(DAY, [], T0 + 1), skip(DAY, 'a', true, T0 + 2)]);
    expect(ids(s, DAY)).toEqual([]);
    expect(looseTasks(s, DAY).map((t) => t.id)).toEqual(['a']);
  });
});
