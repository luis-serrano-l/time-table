import { describe, expect, it } from 'vitest';
import { addDays, dayKey, planDay, weekday } from './day';
import { projectProgress } from './project';
import { reduce } from './reduce';
import type { LogEvent } from './types';

const MIN = 60000;
const T0 = new Date(2026, 10, 18, 9, 0).getTime();
const DAY = dayKey(T0);
let n = 0;
const ev = <E extends Omit<LogEvent, 'id'>>(e: E) => ({ ...e, id: `j${n++}` }) as LogEvent;
const project = (budgetMin: number, sessionMin = 60) => [
  ev({ type: 'task.added', at: T0, taskId: 'p', title: 'Thesis', estimateMin: sessionMin }),
  ev({ type: 'project.set', at: T0 + 1, taskId: 'p', budgetMin }),
];
const worked = (fromMin: number, toMin: number) => [
  ev({ type: 'started', at: T0 + fromMin * MIN, taskId: 'p' }),
  ev({ type: 'stopped', at: T0 + toMin * MIN }),
];
const everyDay = ev({ type: 'rule.set', at: T0 + 2, taskId: 'p', from: DAY, days: [0, 1, 2, 3, 4, 5, 6], lengthMin: 60 });

describe('projects', () => {
  it('only logged time counts as spent', () => {
    const s = reduce([...project(600), everyDay, ...worked(0, 25)]);
    const p = projectProgress(s, 'p', T0 + 60 * MIN, DAY)!;
    expect(p.spentMs).toBe(25 * MIN);
    expect(p.budgetMs).toBe(600 * MIN);
    expect(p.status).toBe('open');
  });

  it('a running session counts up to now', () => {
    const s = reduce([...project(600), ev({ type: 'started', at: T0, taskId: 'p' })]);
    expect(projectProgress(s, 'p', T0 + 12 * MIN, DAY)!.spentMs).toBe(12 * MIN);
  });

  it('planned but unworked time is scheduled, not spent', () => {
    const s = reduce([...project(600), everyDay, ...worked(0, 25)]);
    const p = projectProgress(s, 'p', T0 + 60 * MIN, DAY)!;
    // 35 minutes left of today's hour, and an hour on each of the next six days.
    expect(p.scheduledMs).toBe((35 + 6 * 60) * MIN);
  });

  it('time over budget and not finished is "spent"', () => {
    const s = reduce([...project(60), ...worked(0, 61)]);
    expect(projectProgress(s, 'p', T0 + 90 * MIN, DAY)!.status).toBe('spent');
  });

  it('adding budget returns it to open', () => {
    const s = reduce([...project(60), ...worked(0, 61), ev({ type: 'project.set', at: T0 + 70 * MIN, taskId: 'p', budgetMin: 180 })]);
    const p = projectProgress(s, 'p', T0 + 90 * MIN, DAY)!;
    expect(p.status).toBe('open');
    expect(p.budgetMs).toBe(180 * MIN);
  });

  it('finishing stops later occurrences and keeps earlier ones', () => {
    const s = reduce([
      ...project(600),
      everyDay,
      ev({ type: 'task.done', at: T0 + 5 * MIN, taskId: 'p', done: true }),
      ev({ type: 'rule.set', at: T0 + 5 * MIN + 1, taskId: 'p', from: addDays(DAY, 1), days: [], lengthMin: 60 }),
    ]);
    expect(planDay(s, DAY, 540)).toHaveLength(1);
    expect(planDay(s, addDays(DAY, 1), 540)).toHaveLength(0);
    const p = projectProgress(s, 'p', T0 + 10 * MIN, DAY)!;
    expect(p.status).toBe('finished');
    expect(p.scheduledMs).toBe(0);
  });

  it('a session can be a different length on one day', () => {
    const s = reduce([
      ...project(600),
      everyDay,
      ev({ type: 'entry.set', at: T0 + 3, day: DAY, taskId: 'p', lengthMin: 20, pinMin: 600 }),
    ]);
    expect(planDay(s, DAY, 540).map((b) => [b.startMin, b.lengthMin])).toEqual([[600, 20]]);
    expect(planDay(s, addDays(DAY, 1), 540).map((b) => [b.startMin, b.lengthMin])).toEqual([[540, 60]]);
    expect(weekday(DAY)).toBe(3);
  });

  it('is null for a task that is not a project', () => {
    const s = reduce([ev({ type: 'task.added', at: T0, taskId: 'x', title: 'x', estimateMin: 30 })]);
    expect(projectProgress(s, 'x', T0, DAY)).toBeNull();
  });
});
