import { useEffect, useRef, useState } from 'react';
import { activeRule } from '../log/day';
import type { DayKey, LogState, Task } from '../log/types';
import { actions } from '../store/store';
import { DayChips } from './DayChips';
import { hhmm, parseHhmm } from './format';
import { LengthSelect } from './LengthSelect';

type Props = {
  state: LogState;
  /** The project to change, or none to start a new one. */
  task?: Task;
  /** The first day a change to its days applies to. */
  from: DayKey;
  onClose: () => void;
};

/** A project: a total of hours to put in, and the days its sessions land on. */
export function ProjectDialog({ state, task, from, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const rule = task && activeRule(state, task.id);
  const budget = task && state.projects.get(task.id);
  const [title, setTitle] = useState(task?.title ?? '');
  const [hours, setHours] = useState(String(budget ? budget.budgetMin / 60 : 10));
  const [session, setSession] = useState(rule?.lengthMin ?? task?.estimateMin ?? 60);
  const [days, setDays] = useState<number[]>(rule?.days ?? []);
  const [timed, setTimed] = useState(rule?.atMin !== undefined);
  const [time, setTime] = useState(hhmm(rule?.atMin ?? 9 * 60));

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const budgetMin = Math.round(Number(hours) * 60);
  const atMin = timed ? parseHhmm(time) : undefined;
  const ok = title.trim() && budgetMin >= 5 && atMin !== null;

  function save() {
    if (!ok) return;
    const input = { title: title.trim(), budgetMin, sessionMin: session, days, atMin: atMin ?? undefined };
    if (task) actions.editProject(task.id, input, from);
    else actions.addProject(input, from);
    onClose();
  }

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-label={task ? `Project ${task.title}` : 'New project'}>
      <h2>{task ? 'Project' : 'New project'}</h2>
      <div className="fields stack">
        <label>
          Name
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} autoFocus={!task} />
        </label>
        <label>
          Total hours
          <input
            className="hours"
            type="number"
            inputMode="decimal"
            min={0.5}
            step={0.5}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
        </label>
        <label>
          A session lasts
          <LengthSelect value={session} onChange={setSession} label="Session length" />
        </label>
      </div>

      <h3>Days with a session</h3>
      <DayChips days={days} onChange={setDays} />
      <div className="dialog-row fields">
        <label>
          <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} disabled={!days.length} />
          At a set time
        </label>
        {timed && days.length > 0 && (
          <input type="time" step={300} aria-label="Session time" value={time} onChange={(e) => setTime(e.target.value)} />
        )}
      </div>
      <p className="dialog-note">
        Only time you log counts against the total. On the chosen days a session is put on the plan; change its
        length or time for one day there. With no days, add sessions yourself.
      </p>

      <div className="dialog-row dialog-end">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-solid" onClick={save} disabled={!ok}>
          {task ? 'Save project' : 'Create project'}
        </button>
      </div>
    </dialog>
  );
}
