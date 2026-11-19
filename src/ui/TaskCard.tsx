import { useState, type CSSProperties, type FormEvent, type HTMLAttributes } from 'react';
import { ruleFor, type DayEntry } from '../log/day';
import { projectProgress } from '../log/project';
import type { DayKey, LogState } from '../log/types';
import { actions } from '../store/store';
import { clock, daysText, dayWords, dur, span } from './format';

type Props = {
  state: LogState;
  entry: DayEntry;
  day: DayKey;
  now: number;
  /** Logged on this task on the day on screen. */
  ms: number;
  /** 'run': today, tap to start. 'plan': a day to come. 'past': a day gone by. */
  mode: 'run' | 'plan' | 'past';
  running?: boolean;
  drag?: { ref: (el: HTMLElement | null) => void; style?: CSSProperties; grip: HTMLAttributes<HTMLElement>; lifted: boolean };
  onMore?: () => void;
};

const Play = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M6 3.5v13l11-6.5z" />
  </svg>
);
const Pause = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M4.5 3.5h4v13h-4zM11.5 3.5h4v13h-4z" />
  </svg>
);
const Check = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path className="stroke" d="m4 10.5 4 4 8-9" />
  </svg>
);

/** One task on one day: a large target to start it, and what there is to know about it. */
export function TaskCard({ state, entry, day, now, ms, mode, running, drag, onMore }: Props) {
  const { task, done } = entry;
  const [adding, setAdding] = useState(false);
  const [hours, setHours] = useState('5');
  const project = projectProgress(state, task.id, now);
  const rule = ruleFor(state, task.id, day);
  const over = task.estimateMin !== null && ms > task.estimateMin * 60000;

  const meta: string[] = [];
  if (mode === 'plan') {
    if (task.estimateMin !== null) meta.push(`about ${dur(task.estimateMin * 60000)}`);
  } else if (task.estimateMin !== null) meta.push(`${dur(ms)} of ${dur(task.estimateMin * 60000)}`);
  else if (ms >= 30000 || running) meta.push(mode === 'run' ? `${dur(ms)} today` : dur(ms));
  if (rule?.days.length) meta.push(daysText(rule.days));
  if (entry.carriedFrom) meta.push(`from ${dayWords(entry.carriedFrom).weekday}`);

  const text = (
    <>
      <span className="card-mark">{done ? <Check /> : running ? <Pause /> : <Play />}</span>
      <span className="card-text">
        <strong>{task.title}</strong>
        {meta.length > 0 && <small className={over && !done ? 'is-over' : ''}>{meta.join(', ')}</small>}
      </span>
      {running && state.open && <time>{clock(now - state.open.start)}</time>}
    </>
  );

  function addHours(e: FormEvent) {
    e.preventDefault();
    const more = Math.round(Number(hours) * 60);
    if (!project || !(more > 0)) return;
    actions.setBudget(task.id, Math.round(project.budgetMs / 60000) + more);
    setAdding(false);
  }

  const spent = project?.status === 'spent';
  const cls = `card hue-${task.hue}${running ? ' is-running' : ''}${done ? ' is-done' : ''}${spent ? ' is-spent' : ''}${drag?.lifted ? ' is-lifted' : ''}`;

  return (
    <li ref={drag?.ref} className={cls} style={drag?.style}>
      <div className="card-row">
        {mode === 'run' && !done ? (
          <button
            className="card-main"
            aria-pressed={!!running}
            aria-label={`${task.title}${meta.length ? `, ${meta.join(', ')}` : ''}. ${running ? 'Pause' : 'Start'}`}
            onClick={() => actions.toggle(task.id)}
          >
            {text}
          </button>
        ) : (
          <div className="card-main">{text}</div>
        )}
        {done && mode !== 'past' && (
          <button className="btn card-tool" aria-label={`${task.title} is not done yet`} onClick={() => actions.setDone(day, task.id, false)}>
            Not done
          </button>
        )}
        {drag && (
          <button className="card-icon card-grip" aria-label={`Move ${task.title}. Drag, or use the arrow keys.`} {...drag.grip}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M7 4h2v2H7zM11 4h2v2h-2zM7 9h2v2H7zM11 9h2v2h-2zM7 14h2v2H7zM11 14h2v2h-2z" />
            </svg>
          </button>
        )}
        {onMore && (
          <button className="card-icon" aria-label={`Change ${task.title}`} onClick={onMore}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M3 9h3v3H3zM8.5 9h3v3h-3zM14 9h3v3h-3z" />
            </svg>
          </button>
        )}
      </div>

      {project && (
        <div className="card-project">
          <div
            className="bar"
            role="progressbar"
            aria-label={`${task.title}: hours used`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.round((project.spentMs / project.budgetMs) * 100))}
          >
            <span style={{ width: `${Math.min(100, (project.spentMs / project.budgetMs) * 100)}%` }} />
          </div>
          <small>
            {span(project.spentMs)} of {span(project.budgetMs)}
          </small>
          {spent && mode !== 'past' && !adding && (
            <div className="project-spent">
              <span>The hours are used up.</span>
              <button className="btn btn-solid" onClick={() => actions.finishProject(task.id)}>
                Finish project
              </button>
              <button className="btn" onClick={() => setAdding(true)}>
                Add time
              </button>
            </div>
          )}
          {adding && (
            <form className="project-spent" onSubmit={addHours}>
              <input
                className="hours"
                type="number"
                inputMode="decimal"
                min={0.5}
                step={0.5}
                autoFocus
                aria-label="Hours to add"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
              <button className="btn btn-solid" type="submit" disabled={!(Number(hours) > 0)}>
                Add hours
              </button>
              <button className="btn" type="button" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </form>
          )}
        </div>
      )}
    </li>
  );
}
