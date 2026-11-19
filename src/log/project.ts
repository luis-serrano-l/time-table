import type { LogState } from './types';

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
  /** 'spent': the budget is used up and nobody has said the project is finished. */
  status: 'open' | 'spent' | 'finished';
};

export function projectProgress(state: LogState, taskId: string, now: number): ProjectProgress | null {
  const project = state.projects.get(taskId);
  const task = state.tasks.get(taskId);
  if (!project || !task) return null;

  const spentMs = taskTotals(state, now).get(taskId) ?? 0;
  const budgetMs = project.budgetMin * 60000;

  return { spentMs, budgetMs, status: task.done ? 'finished' : spentMs >= budgetMs ? 'spent' : 'open' };
}
