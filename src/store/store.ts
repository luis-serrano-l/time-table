import { useSyncExternalStore } from 'react';
import { activeRule, addDays, dayKey, defaultStart, isRepeating, resolveDay } from '../log/day';
import { emptyState, reduce } from '../log/reduce';
import { MAX_LEN, MIN_LEN, type DayKey, type LogEvent, type LogState } from '../log/types';
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

/** The day's plan as it stands, repeating tasks included, ready to be written back. */
function planFor(day: DayKey) {
  const { startMin, entries } = resolveDay(snap.state, day);
  return { entries, taskIds: entries.map((e) => e.task.id), startMin: startMin ?? defaultStart(day, Date.now()) };
}

const isRunning = (taskId: string) => {
  const open = snap.state.open;
  return open?.kind === 'task' && open.taskId === taskId;
};

export type ProjectInput = { title: string; budgetMin: number; sessionMin: number; days: number[]; atMin?: number };
export type RuleInput = { days: number[]; atMin?: number; lengthMin: number };

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
  addToPlan(day: DayKey, title: string, estimateMin = 30) {
    const taskId = uid();
    const plan = planFor(day);
    append(
      { type: 'task.added', taskId, title, estimateMin },
      { type: 'plan.set', day, taskIds: [...plan.taskIds, taskId], startMin: plan.startMin },
    );
  },
  planExisting(day: DayKey, taskId: string) {
    const plan = planFor(day);
    if (plan.taskIds.includes(taskId)) return;
    append({ type: 'plan.set', day, taskIds: [...plan.taskIds, taskId], startMin: plan.startMin });
  },
  unplan(day: DayKey, taskId: string) {
    const plan = planFor(day);
    const entry = plan.entries.find((e) => e.task.id === taskId);
    if (!entry) return;
    const items: New[] = [
      { type: 'plan.set', day, taskIds: plan.taskIds.filter((id) => id !== taskId), startMin: plan.startMin },
    ];
    // A repeating task would come straight back, so this day's occurrence is skipped.
    if (entry.ruled) items.push({ type: 'entry.set', day, taskId, skip: true });
    // A task taken off today's plan must not keep running out of sight.
    if (day === today() && isRunning(taskId)) items.unshift({ type: 'stopped' });
    append(...items);
  },
  /** Move a task one place earlier (-1) or later (1) among those that are not pinned to a time. */
  move(day: DayKey, taskId: string, by: -1 | 1) {
    const plan = planFor(day);
    const flow = plan.entries.filter((e) => e.pinMin === null).map((e) => e.task.id);
    const i = flow.indexOf(taskId);
    const j = i + by;
    if (i < 0 || j < 0 || j >= flow.length) return;
    [flow[i], flow[j]] = [flow[j], flow[i]];
    let k = 0;
    const taskIds = plan.entries.map((e) => (e.pinMin === null ? flow[k++] : e.task.id));
    append({ type: 'plan.set', day, taskIds, startMin: plan.startMin });
  },
  setPlanStart(day: DayKey, startMin: number) {
    append({ type: 'plan.set', day, taskIds: planFor(day).taskIds, startMin });
  },
  rename(taskId: string, title: string) {
    append({ type: 'task.edited', taskId, title });
  },
  /** A one-off task has one length. A repeating one can differ from day to day. */
  resize(day: DayKey, taskId: string, lengthMin: number) {
    const len = Math.max(MIN_LEN, Math.min(MAX_LEN, lengthMin));
    if (isRepeating(snap.state, taskId)) append({ type: 'entry.set', day, taskId, lengthMin: len });
    else append({ type: 'task.edited', taskId, estimateMin: len });
  },
  /** Fix a task at a clock time on one day, or let it flow again with null. */
  pin(day: DayKey, taskId: string, pinMin: number | null) {
    append({ type: 'entry.set', day, taskId, pinMin });
  },
  setRule(taskId: string, rule: RuleInput, from: DayKey) {
    const set: New = { type: 'rule.set', taskId, from, days: rule.days, atMin: rule.atMin, lengthMin: rule.lengthMin };
    // Finished for good becomes finished today: it has to come up again next time.
    if (snap.state.tasks.get(taskId)?.done) {
      append({ type: 'task.done', taskId, done: false }, { type: 'task.done', taskId, done: true, day: today() }, set);
    } else append(set);
  },
  /** Stop repeating from tomorrow. Days already planned keep what they had. */
  endRule(taskId: string) {
    const rule = activeRule(snap.state, taskId);
    if (!rule) return;
    append({ type: 'rule.set', taskId, from: addDays(today(), 1), days: [], lengthMin: rule.lengthMin });
  },
  addProject(p: ProjectInput, from: DayKey) {
    const taskId = uid();
    const items: New[] = [
      { type: 'task.added', taskId, title: p.title, estimateMin: p.sessionMin },
      { type: 'project.set', taskId, budgetMin: p.budgetMin },
    ];
    if (p.days.length) {
      items.push({ type: 'rule.set', taskId, from, days: p.days, atMin: p.atMin, lengthMin: p.sessionMin });
    }
    append(...items);
  },
  editProject(taskId: string, p: ProjectInput, from: DayKey) {
    const task = snap.state.tasks.get(taskId);
    const rule = activeRule(snap.state, taskId);
    if (!task) return;
    const items: New[] = [];
    if (p.title !== task.title) items.push({ type: 'task.edited', taskId, title: p.title });
    if (p.sessionMin !== task.estimateMin) items.push({ type: 'task.edited', taskId, estimateMin: p.sessionMin });
    if (p.budgetMin !== snap.state.projects.get(taskId)?.budgetMin) {
      items.push({ type: 'project.set', taskId, budgetMin: p.budgetMin });
    }
    const same =
      rule &&
      rule.lengthMin === p.sessionMin &&
      rule.atMin === p.atMin &&
      [...rule.days].sort().join() === [...p.days].sort().join();
    if (p.days.length && !same) {
      items.push({ type: 'rule.set', taskId, from, days: p.days, atMin: p.atMin, lengthMin: p.sessionMin });
    } else if (!p.days.length && rule) {
      items.push({ type: 'rule.set', taskId, from: addDays(today(), 1), days: [], lengthMin: p.sessionMin });
    }
    if (items.length) append(...items);
  },
  /** More hours for a project that needs them. */
  setBudget(taskId: string, budgetMin: number) {
    append({ type: 'project.set', taskId, budgetMin });
  },
  /** The project is finished: no more sessions from tomorrow on. */
  finishProject(taskId: string) {
    const rule = activeRule(snap.state, taskId);
    const items: New[] = [{ type: 'task.done', taskId, done: true }];
    if (rule) items.push({ type: 'rule.set', taskId, from: addDays(today(), 1), days: [], lengthMin: rule.lengthMin });
    if (isRunning(taskId)) items.unshift({ type: 'stopped' });
    append(...items);
  },
  setDone(day: DayKey, taskId: string, done: boolean) {
    const mark: New = isRepeating(snap.state, taskId)
      ? { type: 'task.done', taskId, done, day }
      : { type: 'task.done', taskId, done };
    if (done && isRunning(taskId)) append({ type: 'stopped' }, mark);
    else append(mark);
  },
  /** Done with the running task, whether or not its planned time is up. */
  finish() {
    const open = snap.state.open;
    if (open?.kind === 'task' && open.taskId) actions.setDone(today(), open.taskId, true);
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
