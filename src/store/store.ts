import { useSyncExternalStore } from 'react';
import { activeRule, addDays, dayKey, isRepeating, resolveDay, weekday } from '../log/day';
import { emptyState, reduce } from '../log/reduce';
import type { DayKey, LogEvent, LogState } from '../log/types';
import { fromBackup, mergeLogs, toBackup } from './backup';
import { clearEvents, loadEvents, saveEvents } from './db';
import { clearLocal } from './local';

type Snapshot = {
  ready: boolean;
  state: LogState;
  error: string | null;
  count: number;
  /** What the last change was, while it can still be taken back. */
  undo: string | null;
};

let events: LogEvent[] = [];
let snap: Snapshot = { ready: false, state: emptyState(), error: null, count: 0, undo: null };
const listeners = new Set<() => void>();

function publish(patch: Partial<Snapshot> = {}) {
  // Any change to the log ends the chance to undo the one before it.
  inverse = null;
  clearTimeout(undoTimer);
  snap = { ...snap, state: reduce(events), count: events.length, undo: null, ...patch };
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

// Undo writes new entries that reverse the last change. Nothing is ever taken
// out of the log: it is already saved and may already be in a backup.
const UNDO_MS = 8000;
let inverse: New[] | null = null;
let undoTimer: ReturnType<typeof setTimeout> | undefined;

function offerUndo(label: string, items: New[]) {
  inverse = items;
  snap = { ...snap, undo: label };
  listeners.forEach((l) => l());
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    inverse = null;
    snap = { ...snap, undo: null };
    listeners.forEach((l) => l());
  }, UNDO_MS);
}

/** Picks the timer back up where it was stopped, if this change stopped it. */
const resume = (taskId: string, wasRunning: boolean): New[] =>
  wasRunning ? [{ type: 'started', taskId, reopen: true }] : [];

const uid = () => crypto.randomUUID();
const today = () => dayKey(Date.now());

/** The day's list as it stands, repeating and carried tasks included, ready to be written back. */
function planFor(day: DayKey) {
  const entries = resolveDay(snap.state, day, today());
  return { entries, taskIds: entries.map((e) => e.task.id) };
}

const isRunning = (taskId: string) => {
  const open = snap.state.open;
  return open?.kind === 'task' && open.taskId === taskId;
};

/** Putting a task on a day undoes an earlier "take off" for that day. */
const unskip = (day: DayKey, taskId: string): New[] =>
  snap.state.overrides.get(day)?.get(taskId)?.skip ? [{ type: 'entry.set', day, taskId, skip: false }] : [];

export type TaskInput = {
  title: string;
  estimateMin: number | null;
  /** Weekdays it repeats on; empty for a task that does not repeat. */
  days: number[];
  /** Total minutes, for a project. */
  budgetMin: number | null;
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
  /** Something unplanned came up: name it and it is on today and already running. */
  startNew(title: string) {
    const taskId = uid();
    const day = today();
    append(
      { type: 'task.added', taskId, title },
      { type: 'plan.set', day, taskIds: [...planFor(day).taskIds, taskId] },
      { type: 'started', taskId },
    );
  },
  /** A new task. One that repeats, or a project with set days, comes up by its rule; anything else goes on `day`. */
  addTask(day: DayKey, t: TaskInput) {
    const taskId = uid();
    const items: New[] = [{ type: 'task.added', taskId, title: t.title, estimateMin: t.estimateMin ?? undefined }];
    if (t.budgetMin) items.push({ type: 'project.set', taskId, budgetMin: t.budgetMin });
    if (t.days.length) items.push({ type: 'rule.set', taskId, from: day, days: t.days });
    if (!t.days.includes(weekday(day))) items.push({ type: 'plan.set', day, taskIds: [...planFor(day).taskIds, taskId] });
    append(...items);
  },
  editTask(taskId: string, t: TaskInput, from: DayKey) {
    const task = snap.state.tasks.get(taskId);
    if (!task) return;
    const rule = activeRule(snap.state, taskId);
    const items: New[] = [];
    if (t.title !== task.title) items.push({ type: 'task.edited', taskId, title: t.title });
    if (t.estimateMin !== task.estimateMin) items.push({ type: 'task.edited', taskId, estimateMin: t.estimateMin });
    if (t.budgetMin && t.budgetMin !== snap.state.projects.get(taskId)?.budgetMin) {
      items.push({ type: 'project.set', taskId, budgetMin: t.budgetMin });
    }
    const same = rule && [...rule.days].sort().join() === [...t.days].sort().join();
    if (t.days.length && !same) {
      // Finished for good becomes finished today: it has to come up again next time.
      if (task.done) {
        items.push({ type: 'task.done', taskId, done: false }, { type: 'task.done', taskId, done: true, day: today() });
      }
      items.push({ type: 'rule.set', taskId, from, days: t.days });
    } else if (!t.days.length && rule) {
      // Stops from tomorrow. Days already gone keep what they had.
      items.push({ type: 'rule.set', taskId, from: addDays(today(), 1), days: [] });
    }
    if (items.length) append(...items);
  },
  planExisting(day: DayKey, taskId: string) {
    const plan = planFor(day);
    if (plan.taskIds.includes(taskId)) return;
    append(...unskip(day, taskId), { type: 'plan.set', day, taskIds: [...plan.taskIds, taskId] });
  },
  unplan(day: DayKey, taskId: string) {
    const plan = planFor(day);
    const entry = plan.entries.find((e) => e.task.id === taskId);
    if (!entry) return;
    const items: New[] = [];
    if (entry.listed) items.push({ type: 'plan.set', day, taskIds: plan.entries.filter((e) => e.listed && e.task.id !== taskId).map((e) => e.task.id) });
    // A repeating task would come straight back, and so would one carried over
    // from an earlier day, so the day itself says it was taken off.
    items.push({ type: 'entry.set', day, taskId, skip: true });
    // A task taken off today must not keep running out of sight.
    const stops = day === today() && isRunning(taskId);
    if (stops) items.unshift({ type: 'stopped' });
    append(...items);
    const back: New[] = [{ type: 'entry.set', day, taskId, skip: false }];
    if (entry.listed) back.unshift({ type: 'plan.set', day, taskIds: plan.entries.filter((e) => e.listed).map((e) => e.task.id) });
    offerUndo(`Took ${entry.task.title} off ${day === today() ? 'today' : 'that day'}`, [...back, ...resume(taskId, stops)]);
  },
  /** The day's tasks in a new order. Every task on the day is written down, so the order holds. */
  reorder(day: DayKey, taskIds: string[]) {
    const plan = planFor(day);
    const known = new Set(plan.taskIds);
    const next = [...taskIds.filter((id) => known.has(id)), ...plan.taskIds.filter((id) => !taskIds.includes(id))];
    if (next.join() !== plan.entries.filter((e) => e.listed).map((e) => e.task.id).join()) {
      append({ type: 'plan.set', day, taskIds: next });
    }
  },
  /** More hours for a project that needs them. */
  setBudget(taskId: string, budgetMin: number) {
    append({ type: 'project.set', taskId, budgetMin });
  },
  /** The project is finished: no more sessions from tomorrow on. */
  finishProject(taskId: string) {
    const rule = activeRule(snap.state, taskId);
    const items: New[] = [{ type: 'task.done', taskId, done: true }];
    if (rule) items.push({ type: 'rule.set', taskId, from: addDays(today(), 1), days: [] });
    const stops = isRunning(taskId);
    if (stops) items.unshift({ type: 'stopped' });
    append(...items);
    const back: New[] = [{ type: 'task.done', taskId, done: false }];
    if (rule) {
      back.push({ type: 'rule.set', taskId, from: addDays(today(), 1), days: rule.days });
    }
    offerUndo(`Finished ${snap.state.tasks.get(taskId)?.title ?? 'the project'}`, [...back, ...resume(taskId, stops)]);
  },
  setDone(day: DayKey, taskId: string, done: boolean) {
    const mark: New = isRepeating(snap.state, taskId)
      ? { type: 'task.done', taskId, done, day }
      : { type: 'task.done', taskId, done };
    const stops = done && isRunning(taskId);
    if (stops) append({ type: 'stopped' }, mark);
    else append(mark);
    if (done) {
      offerUndo(`Finished ${snap.state.tasks.get(taskId)?.title ?? 'the task'}`, [
        { ...mark, done: false } as New,
        ...resume(taskId, stops),
      ]);
    }
  },
  /** Done with the running task: for good, or for today if it repeats or is a project. */
  finish() {
    const open = snap.state.open;
    if (open?.kind === 'task' && open.taskId) actions.setDone(today(), open.taskId, true);
  },
  remove(taskId: string) {
    const stops = isRunning(taskId);
    if (stops) append({ type: 'stopped' }, { type: 'task.removed', taskId });
    else append({ type: 'task.removed', taskId });
    offerUndo(`Deleted ${snap.state.tasks.get(taskId)?.title ?? 'the task'}`, [
      { type: 'task.removed', taskId, removed: false },
      ...resume(taskId, stops),
    ]);
  },
  /** Take back the last delete, take-off or finish. */
  undo() {
    const items = inverse;
    if (items) append(...items);
  },
  /** The timer was forgotten: the work really ended at `endAt`. */
  stopAt(endAt: number) {
    append({ type: 'stopped', endAt });
  },
  /** Correct when a logged stretch started or ended. The caller has checked it with checkEntry. */
  editEntry(segId: string, change: { start?: number; end?: number }) {
    append({ type: 'seg.edited', segId, ...change });
  },
  removeEntry(segId: string, label: string) {
    append({ type: 'seg.edited', segId, removed: true });
    offerUndo(`Deleted ${label}`, [{ type: 'seg.edited', segId, removed: false }]);
  },
  /** Write in work that was never timed. */
  addEntry(taskId: string, start: number, end: number) {
    append({ type: 'seg.added', taskId, start, end });
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
    clearLocal();
    events = [];
    publish();
  },
};
