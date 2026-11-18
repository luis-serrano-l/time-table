import { useSyncExternalStore } from 'react';
import { dayKey, defaultStartMin } from '../log/day';
import { emptyState, reduce } from '../log/reduce';
import type { DayKey, LogEvent, LogState } from '../log/types';
import { fromBackup, mergeLogs, toBackup } from './backup';
import { clearEvents, loadEvents, saveEvents } from './db';

type Snapshot = { ready: boolean; state: LogState; error: string | null; count: number };

let events: LogEvent[] = [];
let snap: Snapshot = { ready: false, state: emptyState(), error: null, count: 0 };
const listeners = new Set<() => void>();

function publish(patch: Partial<Snapshot> = {}) {
  snap = { ...snap, state: reduce(events), count: events.length, ...patch };
  listeners.forEach((l) => l());
}

export function useLog(): Snapshot {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snap,
  );
}

export async function init() {
  try {
    events = mergeLogs(await loadEvents(), []);
    publish({ ready: true });
    // Ask the browser not to evict the log when storage runs low.
    void navigator.storage?.persist?.();
  } catch {
    publish({ ready: true, error: 'This browser would not open local storage, so nothing can be saved.' });
  }
}

type New = LogEvent extends infer E ? (E extends LogEvent ? Omit<E, 'id' | 'at'> : never) : never;

function append(...items: New[]) {
  // Never write an event earlier than the last one: the log stays in order
  // even if the device clock jumps back.
  // Each event also gets its own millisecond, so time order alone is enough
  // to replay the log the same way after a reload or a merge.
  const last = events.length ? events[events.length - 1].at : 0;
  const at = Math.max(Date.now(), last + 1);
  const added = items.map((e, i) => ({ ...e, id: crypto.randomUUID(), at: at + i }) as LogEvent);
  events = [...events, ...added];
  publish();
  saveEvents(added).catch(() =>
    publish({ error: 'The last change could not be saved. Export a backup now.' }),
  );
}

const uid = () => crypto.randomUUID();
const today = () => dayKey(Date.now());

function planFor(day: DayKey) {
  return snap.state.plans.get(day) ?? { taskIds: [], startMin: defaultStartMin(Date.now()) };
}

const isRunning = (taskId: string) => {
  const open = snap.state.open;
  return open?.kind === 'task' && open.taskId === taskId;
};

export const actions = {
  /** Tap a task: start it, or pause it if it is the one running. */
  toggle(taskId: string) {
    if (isRunning(taskId)) append({ type: 'stopped' });
    else append({ type: 'started', taskId });
  },
  pause() {
    append({ type: 'stopped' });
  },
  interrupt() {
    append({ type: 'interruption.started' });
  },
  endInterruption() {
    append({ type: 'interruption.ended' });
  },
  /** Something unplanned came up: name it and it is already running. */
  startNew(title: string, estimateMin = 30) {
    const taskId = uid();
    append(
      { type: 'task.added', taskId, title, estimateMin },
      { type: 'started', taskId },
    );
  },
  addToPlan(title: string, estimateMin = 30) {
    const taskId = uid();
    const plan = planFor(today());
    append(
      { type: 'task.added', taskId, title, estimateMin },
      { type: 'plan.set', day: today(), taskIds: [...plan.taskIds, taskId], startMin: plan.startMin },
    );
  },
  planExisting(taskId: string) {
    const plan = planFor(today());
    if (plan.taskIds.includes(taskId)) return;
    append({ type: 'plan.set', day: today(), taskIds: [...plan.taskIds, taskId], startMin: plan.startMin });
  },
  unplan(taskId: string) {
    const plan = planFor(today());
    const off: New = {
      type: 'plan.set',
      day: today(),
      taskIds: plan.taskIds.filter((id) => id !== taskId),
      startMin: plan.startMin,
    };
    // A task taken off the plan must not keep running out of sight.
    if (isRunning(taskId)) append({ type: 'stopped' }, off);
    else append(off);
  },
  move(taskId: string, to: number) {
    const plan = planFor(today());
    const ids = plan.taskIds.filter((id) => id !== taskId);
    ids.splice(Math.max(0, Math.min(ids.length, to)), 0, taskId);
    if (ids.join() === plan.taskIds.join()) return;
    append({ type: 'plan.set', day: today(), taskIds: ids, startMin: plan.startMin });
  },
  setPlanStart(startMin: number) {
    const plan = planFor(today());
    append({ type: 'plan.set', day: today(), taskIds: plan.taskIds, startMin });
  },
  edit(taskId: string, patch: { title?: string; estimateMin?: number }) {
    append({ type: 'task.edited', taskId, ...patch });
  },
  setDone(taskId: string, done: boolean) {
    if (done && isRunning(taskId)) append({ type: 'stopped' }, { type: 'task.done', taskId, done });
    else append({ type: 'task.done', taskId, done });
  },
  /** Done with the running task, whether or not its planned time is up. */
  finish() {
    const open = snap.state.open;
    if (open?.kind === 'task' && open.taskId) actions.setDone(open.taskId, true);
  },
  remove(taskId: string) {
    if (isRunning(taskId)) append({ type: 'stopped' }, { type: 'task.removed', taskId });
    else append({ type: 'task.removed', taskId });
  },
  dismissError() {
    publish({ error: null });
  },

  exportText() {
    return toBackup(events, Date.now());
  },
  /** Merge a backup into the log. Returns how many entries were new. */
  async importText(text: string) {
    const incoming = fromBackup(text);
    const merged = mergeLogs(events, incoming);
    const added = merged.length - events.length;
    await saveEvents(merged);
    events = merged;
    publish();
    return added;
  },
  async eraseAll() {
    await clearEvents();
    events = [];
    publish();
  },
};
