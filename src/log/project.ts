import { addDays, resolveDay } from './day';
import type { DayKey, LogState } from './types';

/** All the time ever logged on each task, a running stretch counted up to now. */
export function taskTotals(state: LogState, now: number): Map<string, number> {
  const totals = new Map<string, number>();
  for (const seg of state.segments) {
    if (seg.kind !== 'task' || !seg.taskId) continue;
    const ms = Math.max(0, (seg.end ?? now) - seg.start);
    totals.set(seg.taskId, (totals.get(seg.taskId) ?? 0) + ms);
  }
  return totals;
}

export type ProjectProgress = {
  /** Time actually logged. Only this uses up the budget. */
  spentMs: number;
  budgetMs: number;
  /** Planned for today and the next six days, and not worked yet. */
  scheduledMs: number;
  /** 'spent': the budget is used up and nobody has said the project is finished. */
  status: 'open' | 'spent' | 'finished';
};

export function projectProgress(state: LogState, taskId: string, now: number, today: DayKey): ProjectProgress | null {
  const project = state.projects.get(taskId);
  const task = state.tasks.get(taskId);
  if (!project || !task) return null;

  const spentMs = taskTotals(state, now).get(taskId) ?? 0;
  const budgetMs = project.budgetMin * 60000;

  let scheduledMs = 0;
  if (!task.done) {
    for (let i = 0; i < 7; i++) {
      const day = addDays(today, i);
      const entry = resolveDay(state, day).entries.find((e) => e.task.id === taskId);
      if (!entry || entry.done) continue;
      scheduledMs += i === 0 ? Math.max(0, entry.lengthMin * 60000 - loggedOn(state, taskId, day, now)) : entry.lengthMin * 60000;
    }
  }

  return { spentMs, budgetMs, scheduledMs, status: task.done ? 'finished' : spentMs >= budgetMs ? 'spent' : 'open' };
}

function loggedOn(state: LogState, taskId: string, day: DayKey, now: number): number {
  const [y, m, d] = day.split('-').map(Number);
  const from = new Date(y, m - 1, d).getTime();
  const to = new Date(y, m - 1, d + 1).getTime();
  let ms = 0;
  for (const seg of state.segments) {
    if (seg.taskId !== taskId) continue;
    ms += Math.max(0, Math.min(seg.end ?? now, to) - Math.max(seg.start, from));
  }
  return ms;
}
