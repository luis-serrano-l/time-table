import { describe, expect, it } from 'vitest';
import { dayKey, dayRange, daySegments, dayStats, layoutPlan } from './day';
import { reduce } from './reduce';
import type { LogEvent } from './types';

const MIN = 60000;
const T0 = new Date(2026, 10, 18, 9, 0).getTime(); // 18 Nov 2026, 09:00 local
let n = 0;
const ev = <E extends Omit<LogEvent, 'id'>>(e: E) => ({ ...e, id: `e${n++}` }) as LogEvent;
const add = (taskId: string, estimateMin = 30) =>
  ev({ type: 'task.added', at: T0, taskId, title: taskId, estimateMin });
const start = (taskId: string, min: number) => ev({ type: 'started', at: T0 + min * MIN, taskId });
const at = (type: 'stopped' | 'interruption.started' | 'interruption.ended', min: number) =>
  ev({ type, at: T0 + min * MIN });

describe('reduce', () => {
  it('runs only one thing at a time', () => {
    const s = reduce([add('a'), add('b'), start('a', 0), start('b', 10)]);
    expect(s.segments).toHaveLength(2);
    expect(s.segments[0].end).toBe(T0 + 10 * MIN);
    expect(s.segments.filter((x) => x.end === undefined)).toHaveLength(1);
    expect(s.open?.taskId).toBe('b');
  });

  it('ignores starting the task that is already running', () => {
    const s = reduce([add('a'), start('a', 0), start('a', 5)]);
    expect(s.segments).toHaveLength(1);
  });

  it('pauses on stop', () => {
    const s = reduce([add('a'), start('a', 0), at('stopped', 7)]);
    expect(s.open).toBeNull();
    expect(s.segments[0].end).toBe(T0 + 7 * MIN);
  });

  it('parks the task during an interruption and resumes it after', () => {
    const s = reduce([
      add('a'),
      start('a', 0),
      at('interruption.started', 10),
      at('interruption.ended', 14),
    ]);
    expect(s.segments.map((x) => x.kind)).toEqual(['task', 'interruption', 'task']);
    expect(s.segments[1].end! - s.segments[1].start).toBe(4 * MIN);
    expect(s.open?.taskId).toBe('a');
    expect(s.parked).toBeNull();
  });

  it('does not resume anything after an interruption that started from idle', () => {
    const s = reduce([add('a'), at('interruption.started', 0), at('interruption.ended', 3)]);
    expect(s.open).toBeNull();
    expect(s.segments).toHaveLength(1);
  });

  it('starting a task during an interruption ends it and drops the parked task', () => {
    const s = reduce([
      add('a'),
      add('b'),
      start('a', 0),
      at('interruption.started', 5),
      start('b', 8),
      at('interruption.ended', 9),
    ]);
    expect(s.open?.taskId).toBe('b');
    expect(s.segments).toHaveLength(3);
  });

  it('ignores events for unknown tasks', () => {
    const s = reduce([start('ghost', 0)]);
    expect(s.segments).toHaveLength(0);
  });

  it('gives each task a colour and applies edits', () => {
    const s = reduce([
      add('a'),
      add('b'),
      ev({ type: 'task.edited', at: T0, taskId: 'b', title: 'B2', estimateMin: 45 }),
      ev({ type: 'task.done', at: T0, taskId: 'a', done: true }),
    ]);
    expect(s.tasks.get('a')!.hue).not.toBe(s.tasks.get('b')!.hue);
    expect(s.tasks.get('b')).toMatchObject({ title: 'B2', estimateMin: 45 });
    expect(s.tasks.get('a')!.done).toBe(true);
  });
});

describe('day', () => {
  const key = dayKey(T0);

  it('lays the plan out end to end, skipping removed tasks', () => {
    const s = reduce([
      add('a', 30),
      add('b', 45),
      add('c', 15),
      ev({ type: 'task.removed', at: T0, taskId: 'b' }),
      ev({ type: 'plan.set', at: T0, day: key, taskIds: ['a', 'b', 'c'], startMin: 540 }),
    ]);
    const blocks = layoutPlan(s, s.plans.get(key));
    expect(blocks.map((b) => [b.task.id, b.startMin, b.endMin])).toEqual([
      ['a', 540, 570],
      ['c', 570, 585],
    ]);
  });

  it('counts time, switches, interruptions and deep stretches', () => {
    const s = reduce([
      add('a'),
      add('b'),
      start('a', 0),
      start('b', 30), // switch, and a 30 min deep stretch on a
      at('interruption.started', 40),
      at('interruption.ended', 45),
      at('stopped', 50),
      start('a', 80), // after a break: not a switch
      at('stopped', 90),
    ]);
    const st = dayStats(daySegments(s, key, T0 + 120 * MIN));
    expect(st.trackedMs).toBe(55 * MIN);
    expect(st.interruptedMs).toBe(5 * MIN);
    expect(st.interruptions).toBe(1);
    expect(st.switches).toBe(1);
    expect(st.deepStretches).toBe(1);
    expect(st.perTask.get('a')).toBe(40 * MIN);
    expect(st.perTask.get('b')).toBe(15 * MIN);
  });

  it('measures a running segment up to now', () => {
    const s = reduce([add('a'), start('a', 0)]);
    const segs = daySegments(s, key, T0 + 12 * MIN);
    expect(segs).toHaveLength(1);
    expect(segs[0].running).toBe(true);
    expect(segs[0].end - segs[0].start).toBe(12 * MIN);
    expect(segs[0].startMin).toBe(540);
  });

  it('splits a segment that crosses midnight between the two days', () => {
    const late = new Date(2026, 10, 18, 23, 30).getTime();
    const s = reduce([
      add('a'),
      ev({ type: 'started', at: late, taskId: 'a' }),
      ev({ type: 'stopped', at: late + 60 * MIN }),
    ]);
    const today = daySegments(s, key, late + 120 * MIN);
    const tomorrow = daySegments(s, dayKey(late + 60 * MIN), late + 120 * MIN);
    expect(today[0].end - today[0].start).toBe(30 * MIN);
    expect(tomorrow[0].end - tomorrow[0].start).toBe(30 * MIN);
    expect(tomorrow[0].startMin).toBe(0);
    // Still one deep stretch of an hour, counted on both sides.
    expect(dayStats(today).deepStretches).toBe(1);
  });

  it('gives day boundaries at local midnight', () => {
    const [from, to] = dayRange('2026-11-18');
    expect(new Date(from).getHours()).toBe(0);
    expect(dayKey(from)).toBe('2026-11-18');
    expect(dayKey(to - 1)).toBe('2026-11-18');
    expect(dayKey(to)).toBe('2026-11-19');
  });
});
