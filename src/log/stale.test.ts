import { describe, expect, it } from 'vitest';
import { dayKey } from './day';
import { reduce } from './reduce';
import { snoozeFor, staleTimer } from './stale';
import type { LogEvent } from './types';

const MIN = 60000;
const T0 = new Date(2026, 10, 18, 9, 0).getTime(); // a Wednesday
const DAY = dayKey(T0);
let n = 0;
const ev = <E extends Omit<LogEvent, 'id'>>(e: E) => ({ ...e, id: `s${n++}` }) as LogEvent;
const add = (taskId: string, estimateMin = 30) => ev({ type: 'task.added', at: T0 - 1, taskId, title: taskId, estimateMin });
const running = () => reduce([add('a'), ev({ type: 'started', at: T0, taskId: 'a' })]);

describe('forgotten timer', () => {
  it('says nothing while the task is within reach of its plan', () => {
    expect(staleTimer(running(), T0 + 45 * MIN, { plannedMin: 30, loggedMs: 45 * MIN })).toBeNull();
  });

  it('asks after an overrun, and suggests the moment the plan ran out', () => {
    const s = staleTimer(running(), T0 + 50 * MIN, { plannedMin: 30, loggedMs: 50 * MIN });
    expect(s).toEqual({ reason: 'overrun', segStart: T0, suggestedEnd: T0 + 30 * MIN });
  });

  it('gives a short task 20 minutes and a long one an hour', () => {
    expect(staleTimer(running(), T0 + 24 * MIN, { plannedMin: 5, loggedMs: 24 * MIN })).toBeNull();
    expect(staleTimer(running(), T0 + 25 * MIN, { plannedMin: 5, loggedMs: 25 * MIN })).not.toBeNull();
    expect(staleTimer(running(), T0 + 290 * MIN, { plannedMin: 240, loggedMs: 290 * MIN })).toBeNull();
    expect(staleTimer(running(), T0 + 300 * MIN, { plannedMin: 240, loggedMs: 300 * MIN })).not.toBeNull();
  });

  it('asks after a long gap, and suggests when the app was last open', () => {
    const s = staleTimer(running(), T0 + 200 * MIN, { gap: { segStart: T0, lastSeen: T0 + 10 * MIN } });
    expect(s).toEqual({ reason: 'gap', segStart: T0, suggestedEnd: T0 + 10 * MIN });
  });

  it('stays quiet while snoozed, then asks again', () => {
    const snooze = snoozeFor(T0, T0 + 50 * MIN, null);
    const o = { plannedMin: 30, loggedMs: 60 * MIN, snooze };
    expect(staleTimer(running(), T0 + 60 * MIN, o)).toBeNull();
    expect(staleTimer(running(), T0 + 81 * MIN, { ...o, loggedMs: 81 * MIN })).not.toBeNull();
  });

  it('snoozes for longer each time', () => {
    const one = snoozeFor(T0, T0, null);
    const two = snoozeFor(T0, T0, one);
    const three = snoozeFor(T0, T0, two);
    const four = snoozeFor(T0, T0, three);
    expect([one, two, three, four].map((s) => (s.until - T0) / MIN)).toEqual([30, 60, 120, 120]);
  });

  it('a new segment is not snoozed', () => {
    const snooze = snoozeFor(T0 - 999, T0, null);
    expect(staleTimer(running(), T0 + 50 * MIN, { plannedMin: 30, loggedMs: 50 * MIN, snooze })).not.toBeNull();
    expect(snoozeFor(T0, T0, snooze).count).toBe(1);
  });

  it('says nothing when nothing is running', () => {
    expect(staleTimer(reduce([add('a')]), T0, { plannedMin: 30, loggedMs: 99 * MIN })).toBeNull();
  });
});

describe('undo', () => {
  it('undo of delete restores the task and its running segment', () => {
    const s = reduce([
      add('a'),
      ev({ type: 'started', at: T0, taskId: 'a' }),
      ev({ type: 'stopped', at: T0 + 10 * MIN }),
      ev({ type: 'task.removed', at: T0 + 10 * MIN + 1, taskId: 'a' }),
      ev({ type: 'task.removed', at: T0 + 10 * MIN + 3000, taskId: 'a', removed: false }),
      ev({ type: 'started', at: T0 + 10 * MIN + 3001, taskId: 'a', reopen: true }),
    ]);
    expect(s.tasks.get('a')!.removed).toBe(false);
    expect(s.segments).toHaveLength(1);
    expect(s.open?.start).toBe(T0);
  });

  it('undo of finish makes the task unfinished again, for that day only when it repeats', () => {
    const s = reduce([
      add('a'),
      ev({ type: 'task.done', at: T0, taskId: 'a', done: true, day: DAY }),
      ev({ type: 'task.done', at: T0 + 1, taskId: 'a', done: false, day: DAY }),
    ]);
    expect(s.tasks.get('a')!.doneOn.size).toBe(0);
  });
});
