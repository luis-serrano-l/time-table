import { useEffect, useRef, useState } from 'react';
import { activeRule, weekday } from '../log/day';
import type { DayKey, LogState, Task } from '../log/types';
import { actions } from '../store/store';
import { dayShort, hhmm, parseHhmm, WEEK } from './format';
import { LengthSelect } from './LengthSelect';

type Props = {
  state: LogState;
  task: Task;
  /** The first day the rule applies to. */
  from: DayKey;
  /** What to offer when the task does not repeat yet. */
  startMin: number;
  lengthMin: number;
  onClose: () => void;
};

/** Which days a task repeats on, at what time, and for how long. */
export function RepeatDialog({ state, task, from, startMin, lengthMin, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const rule = activeRule(state, task.id);
  const [days, setDays] = useState<number[]>(rule?.days ?? [weekday(from)]);
  const [time, setTime] = useState(hhmm(rule?.atMin ?? Math.min(23 * 60 + 55, Math.round(startMin / 5) * 5)));
  const [length, setLength] = useState(rule?.lengthMin ?? lengthMin);
  const atMin = parseHhmm(time);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const flip = (d: number) => setDays((v) => (v.includes(d) ? v.filter((x) => x !== d) : [...v, d]));

  function save() {
    if (atMin === null || !days.length) return;
    actions.setRule(task.id, { days, atMin, lengthMin: length }, from);
    onClose();
  }

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-label={`Repeat ${task.title}`}>
      <h2>Repeat {task.title}</h2>
      <div className="days" role="group" aria-label="Days">
        {WEEK.map((d) => (
          <button key={d} type="button" className="day-chip" aria-pressed={days.includes(d)} onClick={() => flip(d)}>
            {dayShort(d)}
          </button>
        ))}
      </div>
      <div className="dialog-row">
        <button type="button" className="btn" onClick={() => setDays([...WEEK])}>
          Every day
        </button>
        <button type="button" className="btn" onClick={() => setDays([1, 2, 3, 4, 5])}>
          Weekdays
        </button>
      </div>
      <div className="dialog-row fields">
        <label>
          At
          <input type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label>
          For
          <LengthSelect value={length} onChange={setLength} label="Length each time" />
        </label>
      </div>
      <p className="dialog-note">
        On those days it is put on the plan at that time. You can still move it, resize it or take it off for one
        day.
      </p>
      <div className="dialog-row dialog-end">
        {rule && (
          <button
            type="button"
            className="btn btn-bad"
            onClick={() => {
              actions.endRule(task.id);
              onClose();
            }}
          >
            Stop repeating
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-solid" onClick={save} disabled={atMin === null || !days.length}>
          Save repeat
        </button>
      </div>
    </dialog>
  );
}
