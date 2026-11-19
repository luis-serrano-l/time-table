import { useEffect, useRef, useState, type FormEvent } from 'react';
import { atMinute, checkEntry, dayRange, daySegments, resolveDay, dayKey, snapEntry } from '../log/day';
import type { DayKey, LogState } from '../log/types';
import { actions } from '../store/store';
import { dayWords, parseHhmm, timeOf } from './format';

type Props = {
  state: LogState;
  day: DayKey;
  now: number;
  /** The entry to correct, or none to write one in by hand. */
  segId?: string;
  onClose: () => void;
};

/** Correct when something started or ended, delete it, or write in work that was never timed. */
export function EntryDialog({ state, day, now, segId, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const seg = segId ? state.segments.find((s) => s.id === segId) : undefined;
  const [from, to] = dayRange(day);
  const today = dayKey(now);

  // A new entry starts where the day's last one ended, and runs half an hour or up to now.
  const [first] = useState(() => {
    if (seg) return { start: seg.start, end: seg.end };
    const last = daySegments(state, day, now).at(-1);
    const start = Math.min(last ? last.end : atMinute(day, 9 * 60), now - 60000);
    return { start, end: Math.min(start + 30 * 60000, now) };
  });
  // Only an edge that lies on the day on screen can be typed as a time.
  const startHere = first.start >= from && first.start < to;
  const endHere = first.end !== undefined && first.end > from && first.end <= to;

  const tasks = (() => {
    const onDay = resolveDay(state, day, today).map((e) => e.task);
    const rest = [...state.tasks.values()].filter((t) => !t.removed && !onDay.includes(t));
    return [...onDay, ...rest];
  })();
  const [taskId, setTaskId] = useState(tasks[0]?.id ?? '');
  const [start, setStart] = useState(timeOf(first.start));
  const [end, setEnd] = useState(first.end !== undefined ? timeOf(first.end) : '');
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
    // Opening to change something should not bring the keyboard up: focus the dialog, not its first field.
    if (segId) ref.current?.focus();
  }, []);

  if (segId && !seg) return null;
  const task = seg?.taskId ? state.tasks.get(seg.taskId) : undefined;
  const what = seg ? (seg.kind === 'interruption' ? 'Interruption' : (task?.title ?? 'Task')) : 'Add an entry';
  const running = !!seg && seg.end === undefined;

  function save(e: FormEvent) {
    e.preventDefault();
    const s = parseHhmm(start);
    const en = parseHhmm(end);
    // A time that was not retyped keeps its seconds.
    let nextStart = startHere && s !== null && start !== timeOf(first.start) ? atMinute(day, s) : first.start;
    let nextEnd = running ? undefined : endHere && en !== null && end !== timeOf(first.end!) ? atMinute(day, en) : first.end;
    if (!seg) {
      if (s === null || en === null) return setProblem('Give a start and an end.');
      nextStart = atMinute(day, s);
      nextEnd = atMinute(day, en);
    }
    ({ start: nextStart, end: nextEnd } = snapEntry(state, segId ?? null, nextStart, nextEnd));
    const bad = checkEntry(state, segId ?? null, nextStart, nextEnd, now);
    if (bad?.kind === 'overlap') {
      const hit = bad.with;
      const other = hit.kind === 'interruption' ? 'an interruption' : (state.tasks.get(hit.taskId ?? '')?.title ?? 'another entry');
      return setProblem(`That overlaps ${other}, ${timeOf(hit.start)} to ${hit.end === undefined ? 'now' : timeOf(hit.end)}.`);
    }
    if (bad) return setProblem(bad.kind === 'empty' ? 'The end has to be after the start.' : 'That is still ahead of now.');
    if (seg) {
      const change: { start?: number; end?: number } = {};
      if (nextStart !== seg.start) change.start = nextStart;
      if (nextEnd !== undefined && nextEnd !== seg.end) change.end = nextEnd;
      if (change.start !== undefined || change.end !== undefined) actions.editEntry(seg.id, change);
    } else if (taskId && nextEnd !== undefined) actions.addEntry(taskId, nextStart, nextEnd);
    onClose();
  }

  return (
    <dialog ref={ref} className="dialog" tabIndex={-1} onClose={onClose}>
      <form onSubmit={save}>
        <h2>{what}</h2>
        <div className="fields stack">
          {!seg && (
            <label>
              Task
              <select className="length" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Started
            {startHere || !seg ? (
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
            ) : (
              <span>
                {dayWords(dayKey(first.start)).weekday}, {timeOf(first.start)}
              </span>
            )}
          </label>
          <label>
            Ended
            {running ? (
              <span>Still running</span>
            ) : endHere || !seg ? (
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
            ) : (
              <span>
                {dayWords(dayKey(first.end!)).weekday}, {timeOf(first.end!)}
              </span>
            )}
          </label>
        </div>
        {problem && (
          <p className="notice notice-bad" role="alert">
            {problem}
          </p>
        )}
        <div className="dialog-row dialog-end">
          {seg && !running && (
            <button
              className="btn btn-bad"
              type="button"
              onClick={() => {
                actions.removeEntry(seg.id, `${what}, ${timeOf(seg.start)} to ${timeOf(seg.end!)}`);
                onClose();
              }}
            >
              Delete entry
            </button>
          )}
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-solid" type="submit" disabled={!seg && !taskId}>
            {seg ? 'Save' : 'Add entry'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
