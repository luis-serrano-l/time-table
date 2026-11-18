import { useState, type FormEvent } from 'react';
import { activeRule } from '../log/day';
import { projectProgress } from '../log/project';
import type { DayKey, LogState, Task } from '../log/types';
import { actions } from '../store/store';
import { daysText, hhmm, span } from './format';
import { ProjectDialog } from './ProjectDialog';

type Props = {
  state: LogState;
  day: DayKey;
  today: DayKey;
  /** "today", or the weekday on screen. */
  name: string;
  now: number;
  planned: Set<string>;
};

/** Each project's hours so far against its total, and what to do when they run out. */
export function Projects({ state, day, today, name, now, planned }: Props) {
  const [dialog, setDialog] = useState<{ task?: Task } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [hours, setHours] = useState('5');
  const projects = [...state.projects.keys()]
    .map((id) => state.tasks.get(id))
    .filter((t): t is Task => !!t && !t.removed && !t.done);

  function addHours(e: FormEvent, taskId: string, budgetMs: number) {
    e.preventDefault();
    const more = Math.round(Number(hours) * 60);
    if (!(more > 0)) return;
    actions.setBudget(taskId, Math.round(budgetMs / 60000) + more);
    setAdding(null);
  }

  return (
    <>
      <div className="plan-sub">
        <h3>Projects</h3>
        <button className="btn" onClick={() => setDialog({})}>
          New project
        </button>
      </div>
      {projects.length === 0 && (
        <p className="plan-hint">A project is a total of hours you work off in sessions, a day at a time.</p>
      )}
      <ul className="project-list">
        {projects.map((t) => {
          const p = projectProgress(state, t.id, now, today)!;
          const rule = activeRule(state, t.id);
          const spent = p.status === 'spent';
          return (
            <li key={t.id} className={spent ? 'is-spent' : ''}>
              <span className={`dot hue-${t.hue}`} />
              <div className="project-text">
                <strong>{t.title}</strong>
                <small>
                  {span(p.spentMs)} of {span(p.budgetMs)}
                  {p.scheduledMs > 0 && `, ${span(p.scheduledMs)} scheduled`}
                </small>
                <small>
                  {rule
                    ? `${daysText(rule.days)}${rule.atMin !== undefined ? ` at ${hhmm(rule.atMin)}` : ''}, ${span(rule.lengthMin * 60000)} a session`
                    : 'No set days'}
                </small>
              </div>
              <div className="project-tools">
                {!planned.has(t.id) && (
                  <button className="btn" aria-label={`Put ${t.title} on ${name}`} onClick={() => actions.planExisting(day, t.id)}>
                    Put on {name}
                  </button>
                )}
                <button className="btn" aria-label={`Change project ${t.title}`} onClick={() => setDialog({ task: t })}>
                  Change
                </button>
              </div>
              <div
                className={`bar hue-${t.hue}`}
                role="progressbar"
                aria-label={`${t.title}: hours used`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, Math.round((p.spentMs / p.budgetMs) * 100))}
              >
                <span style={{ width: `${Math.min(100, (p.spentMs / p.budgetMs) * 100)}%` }} />
              </div>
              {spent && adding !== t.id && (
                <div className="project-spent">
                  <span>The hours are used up.</span>
                  <button className="btn btn-solid" onClick={() => actions.finishProject(t.id)}>
                    Finish project
                  </button>
                  <button className="btn" onClick={() => setAdding(t.id)}>
                    Add time
                  </button>
                </div>
              )}
              {!spent && adding !== t.id && (
                <div className="project-spent is-quiet">
                  <button className="btn" onClick={() => actions.finishProject(t.id)}>
                    Finish project
                  </button>
                  <button className="btn" onClick={() => setAdding(t.id)}>
                    Add time
                  </button>
                </div>
              )}
              {adding === t.id && (
                <form className="project-spent" onSubmit={(e) => addHours(e, t.id, p.budgetMs)}>
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
                  <button className="btn" type="button" onClick={() => setAdding(null)}>
                    Cancel
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      {dialog && (
        <ProjectDialog state={state} task={dialog.task} from={day < today ? today : day} onClose={() => setDialog(null)} />
      )}
    </>
  );
}
