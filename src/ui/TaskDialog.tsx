import { useEffect, useRef, useState, type FormEvent } from 'react';
import { activeRule } from '../log/day';
import type { DayKey, LogState, Task } from '../log/types';
import { actions } from '../store/store';
import { DayChips } from './DayChips';
import { EstimateSelect } from './EstimateSelect';

type Props = {
  state: LogState;
  /** The task to change, or none for a new one. */
  task?: Task;
  title?: string;
  day: DayKey;
  today: DayKey;
  /** "today", or the weekday on screen. */
  dayName: string;
  /** Is the task on the day on screen? Then it can be taken off it. */
  onDay?: boolean;
  onClose: () => void;
};

/** Everything about one task: its name, an estimate, the days it repeats on, and a project's hours. */
export function TaskDialog({ state, task, title: firstTitle, day, today, dayName, onDay, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const project = task ? state.projects.get(task.id) : undefined;
  const [title, setTitle] = useState(task?.title ?? firstTitle ?? '');
  const [estimate, setEstimate] = useState<number | null>(task?.estimateMin ?? null);
  const [days, setDays] = useState<number[]>(() => (task ? (activeRule(state, task.id)?.days ?? []) : []));
  const [isProject, setIsProject] = useState(!!project);
  const [hours, setHours] = useState(project ? String(project.budgetMin / 60) : '10');

  useEffect(() => {
    ref.current?.showModal();
    // Opening to change something should not bring the keyboard up: focus the dialog, not its first field.
    if (task) ref.current?.focus();
  }, []);

  const budgetMin = isProject ? Math.round(Number(hours) * 60) : null;
  const valid = !!title.trim() && (!isProject || (budgetMin !== null && budgetMin > 0));

  function save(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const input = { title: title.trim(), estimateMin: estimate, days, budgetMin };
    // A rule starts on the day on screen, never on one already gone.
    if (task) actions.editTask(task.id, input, day < today ? today : day);
    else actions.addTask(day, input);
    onClose();
  }

  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <dialog ref={ref} className="dialog" tabIndex={-1} onClose={onClose}>
      <form onSubmit={save}>
        <h2>{task ? (project ? 'Change project' : 'Change task') : 'New task'}</h2>
        <div className="fields stack">
          <label>
            Name
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} autoFocus={!task} />
          </label>
          <label>
            Estimate
            <EstimateSelect value={estimate} onChange={setEstimate} />
          </label>
        </div>

        <h3>Repeats on</h3>
        <DayChips days={days} onChange={setDays} />
        <p className="dialog-note">
          {days.length
            ? 'It comes up by itself on those days, and you finish it a day at a time.'
            : isProject
              ? 'No set days: put it on a day whenever you want to work on it.'
              : `It does not repeat. It stays on ${task ? 'its day' : dayName} until it is finished.`}
        </p>

        <div className="fields stack">
          {!project && (
            <label>
              It is a project with a total of hours
              <input type="checkbox" checked={isProject} onChange={(e) => setIsProject(e.target.checked)} />
            </label>
          )}
          {isProject && (
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
          )}
        </div>

        <div className="dialog-row dialog-end">
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-solid" type="submit" disabled={!valid}>
            {task ? 'Save' : 'Add task'}
          </button>
        </div>

        {task && (
          <div className="dialog-row dialog-danger">
            {onDay && (
              <button className="btn" type="button" onClick={act(() => actions.unplan(day, task.id))}>
                Take off {dayName}
              </button>
            )}
            {project && !task.done && (
              <button className="btn" type="button" onClick={act(() => actions.finishProject(task.id))}>
                Finish project
              </button>
            )}
            <button className="btn btn-bad" type="button" onClick={act(() => actions.remove(task.id))}>
              Delete
            </button>
          </div>
        )}
      </form>
    </dialog>
  );
}
