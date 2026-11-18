import { useState, type FormEvent } from 'react';
import { activeRule, type PlanBlock } from '../log/day';
import { projectProgress } from '../log/project';
import { LEN_STEP, MAX_LEN, MIN_LEN, type DayKey, type LogState, type Task } from '../log/types';
import { actions } from '../store/store';
import { daysText, dayWords, dur, hhmm, parseHhmm, span } from './format';
import { LengthSelect } from './LengthSelect';
import { Projects } from './Projects';
import { RepeatDialog } from './RepeatDialog';

type Props = {
  state: LogState;
  day: DayKey;
  today: DayKey;
  blocks: PlanBlock[];
  startMin: number;
  perTask: Map<string, number>;
  now: number;
  open: boolean;
  onClose: () => void;
};

/** The plan as a list: a sheet on a phone, a side column on a wide screen. */
export function PlanPanel({ state, day, today, blocks, startMin, perTask, now, open, onClose }: Props) {
  const [title, setTitle] = useState('');
  const [length, setLength] = useState(30);
  const [repeat, setRepeat] = useState<{ task: Task; startMin: number; lengthMin: number } | null>(null);

  const isToday = day === today;
  const past = day < today;
  const name = isToday ? 'today' : dayWords(day).weekday;
  const planned = new Set(blocks.map((b) => b.task.id));
  const flow = blocks.filter((b) => !b.pinned);
  const total = blocks.reduce((sum, b) => sum + b.lengthMin, 0);
  const endMin = blocks.length ? Math.max(...blocks.map((b) => b.endMin)) : null;

  const tasks = [...state.tasks.values()].filter((t) => !t.removed && !t.done);
  const isProject = (t: Task) => state.projects.has(t.id);
  const repeating = tasks.filter((t) => activeRule(state, t.id) && !isProject(t));
  const later = tasks.filter((t) => !planned.has(t.id) && !activeRule(state, t.id) && !isProject(t));

  function add(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    actions.addToPlan(day, t, length);
    setTitle('');
  }

  return (
    <>
      <div className={`scrim${open ? ' is-open' : ''}`} onClick={onClose} />
      <aside className={`plan${open ? ' is-open' : ''}`} aria-label={`Plan for ${name}`}>
        <div className="plan-head">
          <h2>Plan for {name}</h2>
          <button className="btn plan-close" onClick={onClose}>
            Done
          </button>
        </div>

        <label className="plan-start">
          Start at
          <input
            type="time"
            step={300}
            disabled={past}
            value={hhmm(startMin)}
            onChange={(e) => {
              const m = parseHhmm(e.target.value);
              if (m !== null) actions.setPlanStart(day, m);
            }}
          />
          {endMin !== null && (
            <span>
              {dur(total * 60000)} planned, ends {hhmm(endMin)}
            </span>
          )}
        </label>

        {blocks.length === 0 && (
          <p className="plan-hint">
            {past
              ? 'Nothing was planned that day.'
              : `What deserves your time ${isToday ? 'today' : 'that day'}? Add it below, in the order you mean to do it.`}
          </p>
        )}

        <ol className="plan-list">
          {blocks.map((b) => {
            const t = b.task;
            const i = flow.indexOf(b);
            const rule = activeRule(state, t.id);
            const project = projectProgress(state, t.id, now, today);
            const clash = b.clash && blocks.find((o) => o !== b && o.pinned && o.startMin < b.endMin && b.startMin < o.endMin);
            return (
              <li key={t.id} className={b.done ? 'is-done' : ''}>
                <span className={`dot hue-${t.hue}`} />
                <div className="plan-item">
                  <input
                    className="plan-title"
                    defaultValue={t.title}
                    key={t.title}
                    aria-label="Task name"
                    maxLength={80}
                    readOnly={past}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== t.title) actions.rename(t.id, v);
                      else e.target.value = t.title;
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  />
                  <small>
                    {b.pinned && !past ? (
                      <input
                        className="pin-time"
                        type="time"
                        step={300}
                        aria-label={`Time for ${t.title}`}
                        value={hhmm(b.startMin)}
                        onChange={(e) => {
                          const m = parseHhmm(e.target.value);
                          if (m !== null) actions.pin(day, t.id, m);
                        }}
                      />
                    ) : (
                      hhmm(b.startMin)
                    )}
                    {isToday && <>, {dur(perTask.get(t.id) ?? 0)} logged</>}
                    {rule && <>, repeats {daysText(rule.days).replace(/^(Every|Weekdays)/, (w) => w.toLowerCase())}</>}
                    {project && (
                      <>
                        , {span(project.spentMs)} of {span(project.budgetMs)}
                        {project.status === 'spent' && <strong className="warn"> Hours used up</strong>}
                      </>
                    )}
                    {clash && <strong className="warn"> Overlaps {clash.task.title}</strong>}
                    {b.offDay && <strong className="warn"> Starts after midnight</strong>}
                  </small>
                </div>
                {past ? (
                  <output className="plan-length">{dur(b.lengthMin * 60000)}</output>
                ) : (
                  <>
                    <div className="stepper">
                      <button
                        aria-label={`Shorten ${t.title}`}
                        disabled={b.lengthMin <= MIN_LEN}
                        onClick={() => actions.resize(day, t.id, b.lengthMin - LEN_STEP)}
                      >
                        −
                      </button>
                      <output>{dur(b.lengthMin * 60000)}</output>
                      <button
                        aria-label={`Lengthen ${t.title}`}
                        disabled={b.lengthMin >= MAX_LEN}
                        onClick={() => actions.resize(day, t.id, b.lengthMin + LEN_STEP)}
                      >
                        +
                      </button>
                    </div>
                    <div className="plan-tools">
                      <button
                        aria-label={`Move ${t.title} earlier`}
                        disabled={i <= 0}
                        onClick={() => actions.move(day, t.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        aria-label={`Move ${t.title} later`}
                        disabled={i < 0 || i === flow.length - 1}
                        onClick={() => actions.move(day, t.id, 1)}
                      >
                        ↓
                      </button>
                      <button
                        aria-label={b.pinned ? `Unpin ${t.title} from its time` : `Pin ${t.title} to a time`}
                        aria-pressed={b.pinned}
                        title={b.pinned ? 'Pinned to a time' : 'Pin to a time'}
                        onClick={() =>
                          actions.pin(day, t.id, b.pinned ? null : Math.min(23 * 60 + 55, Math.round(b.startMin / 5) * 5))
                        }
                      >
                        ◆
                      </button>
                      <button
                        hidden={!!project}
                        aria-label={`Repeat ${t.title}`}
                        aria-pressed={!!rule}
                        title="Repeat"
                        onClick={() => setRepeat({ task: t, startMin: b.startMin, lengthMin: b.lengthMin })}
                      >
                        ↻
                      </button>
                      <button
                        aria-label={b.done ? `Mark ${t.title} not finished` : `Mark ${t.title} finished`}
                        aria-pressed={b.done}
                        onClick={() => actions.setDone(day, t.id, !b.done)}
                      >
                        ✓
                      </button>
                      <button aria-label={`Take ${t.title} off ${name}`} onClick={() => actions.unplan(day, t.id)}>
                        ×
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ol>

        {!past && (
          <form className="plan-add" onSubmit={add}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Add a task"
              aria-label={isToday ? 'New task for today' : `New task for ${name}`}
              maxLength={80}
            />
            <LengthSelect value={length} onChange={setLength} />
            <button className="btn btn-solid" type="submit" disabled={!title.trim()}>
              Add
            </button>
          </form>
        )}

        {!past && repeating.length > 0 && (
          <>
            <h3>Repeating</h3>
            <ul className="later-list">
              {repeating.map((t) => {
                const rule = activeRule(state, t.id)!;
                return (
                  <li key={t.id}>
                    <span className={`dot hue-${t.hue}`} />
                    <span className="later-title">
                      {t.title}
                      <small>
                        {daysText(rule.days)}
                        {rule.atMin !== undefined && ` at ${hhmm(rule.atMin)}`}, {dur(rule.lengthMin * 60000)}
                      </small>
                    </span>
                    {!planned.has(t.id) && (
                      <button className="btn" aria-label={`Put ${t.title} on ${name}`} onClick={() => actions.planExisting(day, t.id)}>
                        Put on {name}
                      </button>
                    )}
                    <button
                      className="btn"
                      aria-label={`Change how ${t.title} repeats`}
                      onClick={() => setRepeat({ task: t, startMin: rule.atMin ?? 9 * 60, lengthMin: rule.lengthMin })}
                    >
                      Change
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {!past && <Projects state={state} day={day} today={today} name={name} now={now} planned={planned} />}

        {!past && later.length > 0 && (
          <>
            <h3>Not on {name}</h3>
            <ul className="later-list">
              {later.map((t) => (
                <li key={t.id}>
                  <span className={`dot hue-${t.hue}`} />
                  <span className="later-title">{t.title}</span>
                  <button className="btn" onClick={() => actions.planExisting(day, t.id)}>
                    Add to {name}
                  </button>
                  <button className="btn" aria-label={`Delete ${t.title}`} onClick={() => actions.remove(t.id)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>

      {repeat && (
        <RepeatDialog
          state={state}
          task={repeat.task}
          from={day < today ? today : day}
          startMin={repeat.startMin}
          lengthMin={repeat.lengthMin}
          onClose={() => setRepeat(null)}
        />
      )}
    </>
  );
}
