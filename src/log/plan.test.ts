import { describe, expect, it } from 'vitest';
import { addDays, dayKey, layoutPlan, planDay, resolveDay, weekday, type DayEntry } from './day';
import { reduce } from './reduce';
import type { DayKey, LogEvent, Task } from './types';

const MIN = 60000;
const T0 = new Date(2026, 10, 18, 9, 0).getTime(); // Wednesday 18 Nov 2026, 09:00 local
const DAY = dayKey(T0);
const WED = weekday(DAY);
let n = 0;
const ev = <E extends Omit<LogEvent, 'id'>>(e: E) => ({ ...e, id: `p${n++}` }) as LogEvent;
const add = (taskId: string, estimateMin = 30, min = 0) =>
  ev({ type: 'task.added', at: T0 + min, taskId, title: taskId, estimateMin });
const plan = (day: DayKey, taskIds: string[], startMin = 540) => ev({ type: 'plan.set', at: T0, day, taskIds, startMin });
const rule = (taskId: string, from: DayKey, days: number[], atMin: number | undefined, lengthMin = 30, at = T0) =>
  ev({ type: 'rule.set', at, taskId, from, days, atMin, lengthMin });
const entry = (day: DayKey, taskId: string, patch: { lengthMin?: number; pinMin?: number | null; skip?: boolean }) =>
  ev({ type: 'entry.set', at: T0, day, taskId, ...patch });
const times = (blocks: { task: Task; startMin: number; endMin: number }[]) =>
  blocks.map((b) => [b.task.id, b.startMin, b.endMin]);

describe('reduce, newer entries', () => {
  it('replays a log from before them to the same plan', () => {
    const s = reduce([add('a', 30), add('b', 45), plan(DAY, ['a', 'b'])]);
    expect(times(planDay(s, DAY, 0))).toEqual([
      ['a', 540, 570],
      ['b', 570, 615],
    ]);
    expect(s.tasks.get('a')!.doneOn.size).toBe(0);
  });

  it('entry.set patches one day only, and only the fields it carries', () => {
    const next = addDays(DAY, 1);
    const s = reduce([
      add('a', 30),
      plan(DAY, ['a']),
      plan(next, ['a']),
      entry(DAY, 'a', { lengthMin: 10 }),
      entry(DAY, 'a', { pinMin: 600 }),
    ]);
    expect(times(planDay(s, DAY, 0))).toEqual([['a', 600, 610]]);
    expect(times(planDay(s, next, 0))).toEqual([['a', 540, 570]]);
  });

  it('a null pin overrides the rule\'s time', () => {
    const s = reduce([add('a'), rule('a', DAY, [WED], 600), entry(DAY, 'a', { pinMin: null })]);
    expect(resolveDay(s, DAY).entries[0].pinMin).toBeNull();
  });

  it('rule.set replaces versions from its start day onward', () => {
    const s = reduce([
      add('a'),
      rule('a', DAY, [WED], 600),
      rule('a', addDays(DAY, 14), [WED], 700),
      rule('a', addDays(DAY, 7), [WED], 800),
    ]);
    expect(s.rules.get('a')!.map((v) => [v.from, v.atMin])).toEqual([
      [DAY, 600],
      [addDays(DAY, 7), 800],
    ]);
  });

  it('day-scoped done leaves other days undone', () => {
    const s = reduce([
      add('a'),
      rule('a', DAY, [0, 1, 2, 3, 4, 5, 6], 600),
      ev({ type: 'task.done', at: T0, taskId: 'a', done: true, day: DAY }),
    ]);
    expect(resolveDay(s, DAY).entries[0].done).toBe(true);
    expect(resolveDay(s, addDays(DAY, 1)).entries[0].done).toBe(false);
    expect(s.tasks.get('a')!.done).toBe(false);
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

  it('trimmed only shortens a closed segment', () => {
    const base = [add('a'), ev({ type: 'started', at: T0, taskId: 'a' }), ev({ type: 'stopped', at: T0 + 60 * MIN })];
    const cut = reduce([...base, ev({ type: 'trimmed', at: T0 + 61 * MIN, segStart: T0, endAt: T0 + 20 * MIN })]);
    expect(cut.segments[0].end).toBe(T0 + 20 * MIN);
    const grown = reduce([...base, ev({ type: 'trimmed', at: T0 + 61 * MIN, segStart: T0, endAt: T0 + 99 * MIN })]);
    expect(grown.segments[0].end).toBe(T0 + 60 * MIN);
  });

  it('reopen continues the last segment', () => {
    const s = reduce([
      add('a'),
      ev({ type: 'started', at: T0, taskId: 'a' }),
      ev({ type: 'stopped', at: T0 + 30 * MIN }),
      ev({ type: 'started', at: T0 + 31 * MIN, taskId: 'a', reopen: true }),
    ]);
    expect(s.segments).toHaveLength(1);
    expect(s.open).toBe(s.segments[0]);
    expect(s.segments[0].start).toBe(T0);
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

describe('repeating tasks', () => {
  it('a rule adds an occurrence on its weekdays only', () => {
    const s = reduce([add('a'), rule('a', DAY, [WED], 600, 20)]);
    expect(times(planDay(s, DAY, 0))).toEqual([['a', 600, 620]]);
    expect(planDay(s, addDays(DAY, 1), 0)).toEqual([]);
    expect(times(planDay(s, addDays(DAY, 7), 0))).toEqual([['a', 600, 620]]);
    expect(planDay(s, addDays(DAY, -7), 0)).toEqual([]);
  });

  it('skip removes one occurrence', () => {
    const s = reduce([add('a'), rule('a', DAY, [WED], 600), entry(DAY, 'a', { skip: true })]);
    expect(planDay(s, DAY, 0)).toEqual([]);
    expect(planDay(s, addDays(DAY, 7), 0)).toHaveLength(1);
  });

  it('an explicit listing wins over skip', () => {
    const s = reduce([add('a'), rule('a', DAY, [WED], 600), entry(DAY, 'a', { skip: true }), plan(DAY, ['a'])]);
    expect(planDay(s, DAY, 0)).toHaveLength(1);
  });

  it('editing a rule leaves earlier days alone', () => {
    const later = addDays(DAY, 7);
    const s = reduce([add('a'), rule('a', DAY, [WED], 600, 20), rule('a', later, [WED], 720, 45)]);
    expect(times(planDay(s, DAY, 0))).toEqual([['a', 600, 620]]);
    expect(times(planDay(s, later, 0))).toEqual([['a', 720, 765]]);
  });

  it('ending a rule keeps past occurrences', () => {
    const s = reduce([add('a'), rule('a', DAY, [WED], 600), rule('a', addDays(DAY, 1), [], undefined)]);
    expect(planDay(s, DAY, 0)).toHaveLength(1);
    expect(planDay(s, addDays(DAY, 7), 0)).toEqual([]);
  });

  it('orders occurrences by their time, after the tasks the plan names', () => {
    const s = reduce([add('a'), add('b', 30, 1), add('c', 30, 2), rule('a', DAY, [WED], 800), rule('b', DAY, [WED], 700), plan(DAY, ['c'])]);
    expect(resolveDay(s, DAY).entries.map((e) => e.task.id)).toEqual(['c', 'b', 'a']);
  });

  it('two devices opening the same day yield one occurrence after a merge', () => {
    // Opening a day writes nothing, so each device only has its own real changes.
    const shared = [add('a'), add('b'), rule('a', DAY, [WED], 600)];
    const one = [...shared, plan(DAY, ['b'])];
    const two = [...shared, entry(DAY, 'a', { lengthMin: 10 })];
    const byId = new Map([...one, ...two].map((e) => [e.id, e]));
    const merged = [...byId.values()].sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1));
    expect(times(planDay(reduce(merged), DAY, 0))).toEqual([
      ['b', 540, 570],
      ['a', 600, 610],
    ]);
  });
});

describe('layout', () => {
  const task = (id: string): Task => ({ id, title: id, estimateMin: 30, done: false, removed: false, createdAt: 0, hue: 0, doneOn: new Set() });
  const e = (id: string, lengthMin: number, pinMin: number | null = null): DayEntry => ({
    task: task(id),
    lengthMin,
    pinMin,
    done: false,
    ruled: false,
    listed: true,
  });

  it('flows end to end with no pins', () => {
    expect(times(layoutPlan([e('a', 30), e('b', 5), e('c', 60)], 540))).toEqual([
      ['a', 540, 570],
      ['b', 570, 575],
      ['c', 575, 635],
    ]);
  });

  it('a task that fits stays before a pinned block', () => {
    expect(times(layoutPlan([e('a', 45), e('p', 15, 600)], 540))).toEqual([
      ['a', 540, 585],
      ['p', 600, 615],
    ]);
  });

  it('a task that does not fit moves after it and leaves the gap', () => {
    expect(times(layoutPlan([e('a', 45), e('b', 30), e('p', 15, 600)], 540))).toEqual([
      ['a', 540, 585],
      ['p', 600, 615],
      ['b', 615, 645],
    ]);
  });

  it('a later short task does not backfill', () => {
    expect(times(layoutPlan([e('a', 45), e('b', 30), e('c', 10), e('p', 15, 600)], 540))).toEqual([
      ['a', 540, 585],
      ['p', 600, 615],
      ['b', 615, 645],
      ['c', 645, 655],
    ]);
  });

  it('jumps a chain of pinned blocks', () => {
    expect(times(layoutPlan([e('a', 30), e('p', 30, 550), e('q', 30, 585)], 540))).toEqual([
      ['p', 550, 580],
      ['q', 585, 615],
      ['a', 615, 645],
    ]);
  });

  it('touching a pinned block is not a collision', () => {
    expect(times(layoutPlan([e('a', 60), e('p', 15, 600)], 540))).toEqual([
      ['a', 540, 600],
      ['p', 600, 615],
    ]);
  });

  it('pinned before the plan start stays put', () => {
    expect(times(layoutPlan([e('a', 30), e('p', 30, 420)], 540))).toEqual([
      ['p', 420, 450],
      ['a', 540, 570],
    ]);
  });

  it('a pinned block over the plan start pushes the flow', () => {
    expect(times(layoutPlan([e('a', 30), e('p', 30, 530)], 540))).toEqual([
      ['p', 530, 560],
      ['a', 560, 590],
    ]);
  });

  it('overlapping pinned blocks keep their times, clash, and take two lanes', () => {
    const blocks = layoutPlan([e('p', 60, 600), e('q', 30, 630), e('r', 15, 700)], 540);
    expect(times(blocks)).toEqual([
      ['p', 600, 660],
      ['q', 630, 660],
      ['r', 700, 715],
    ]);
    expect(blocks.map((b) => [b.clash, b.lane])).toEqual([
      [true, 0],
      [true, 1],
      [false, 0],
    ]);
  });

  it('blocks past midnight keep their real end and are flagged', () => {
    const blocks = layoutPlan([e('a', 60), e('b', 30)], 1410);
    expect(times(blocks)).toEqual([
      ['a', 1410, 1470],
      ['b', 1470, 1500],
    ]);
    expect(blocks.map((b) => b.offDay)).toEqual([false, true]);
  });
});
