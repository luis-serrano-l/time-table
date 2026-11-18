import { useState, type FormEvent } from 'react';
import type { PlanBlock } from '../log/day';
import { defaultStartMin } from '../log/day';
import { LEN_STEP, MAX_LEN, MIN_LEN, type LogState, type Plan } from '../log/types';
import { actions } from '../store/store';
import { dur, hhmm, parseHhmm } from './format';
import { LengthSelect } from './LengthSelect';

type Props = {
  state: LogState;
  plan: Plan | undefined;
  blocks: PlanBlock[];
  perTask: Map<string, number>;
  open: boolean;
  onClose: () => void;
};

/** The plan as a list: a sheet on a phone, a side column on a wide screen. */
export function PlanPanel({ state, plan, blocks, perTask, open, onClose }: Props) {
  const [title, setTitle] = useState('');
  const [length, setLength] = useState(30);
  const planned = new Set(blocks.map((b) => b.task.id));
  const later = [...state.tasks.values()].filter((t) => !t.removed && !t.done && !planned.has(t.id));
  const total = blocks.reduce((sum, b) => sum + b.lengthMin, 0);
  const endMin = blocks.length ? blocks[blocks.length - 1].endMin : null;

  function add(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    actions.addToPlan(t, length);
    setTitle('');
  }

  return (
    <>
      <div className={`scrim${open ? ' is-open' : ''}`} onClick={onClose} />
      <aside className={`plan${open ? ' is-open' : ''}`} aria-label="Plan for today">
        <div className="plan-head">
          <h2>Plan for today</h2>
          <button className="btn plan-close" onClick={onClose}>
            Done
          </button>
        </div>

        <label className="plan-start">
          Start at
          <input
            type="time"
            step={300}
            value={hhmm(plan?.startMin ?? defaultStartMin(Date.now()))}
            onChange={(e) => {
              const m = parseHhmm(e.target.value);
              if (m !== null) actions.setPlanStart(m);
            }}
          />
          {endMin !== null && (
            <span>
              {dur(total * 60000)} planned, ends {hhmm(endMin)}
            </span>
          )}
        </label>

        {blocks.length === 0 && (
          <p className="plan-hint">What deserves your time today? Add it below, in the order you mean to do it.</p>
        )}

        <ol className="plan-list">
          {blocks.map((b, i) => (
            <li key={b.task.id} className={b.task.done ? 'is-done' : ''}>
              <span className={`dot hue-${b.task.hue}`} />
              <div className="plan-item">
                <input
                  className="plan-title"
                  defaultValue={b.task.title}
                  key={b.task.title}
                  aria-label="Task name"
                  maxLength={80}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== b.task.title) actions.edit(b.task.id, { title: v });
                    else e.target.value = b.task.title;
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
                <small>
                  {hhmm(b.startMin)}, {dur(perTask.get(b.task.id) ?? 0)} logged
                </small>
              </div>
              <div className="stepper">
                <button
                  aria-label={`Shorten ${b.task.title}`}
                  disabled={b.task.estimateMin <= MIN_LEN}
                  onClick={() => actions.edit(b.task.id, { estimateMin: Math.max(MIN_LEN, b.task.estimateMin - LEN_STEP) })}
                >
                  −
                </button>
                <output>{dur(b.task.estimateMin * 60000)}</output>
                <button
                  aria-label={`Lengthen ${b.task.title}`}
                  disabled={b.task.estimateMin >= MAX_LEN}
                  onClick={() => actions.edit(b.task.id, { estimateMin: Math.min(MAX_LEN, b.task.estimateMin + LEN_STEP) })}
                >
                  +
                </button>
              </div>
              <div className="plan-tools">
                <button aria-label={`Move ${b.task.title} earlier`} disabled={i === 0} onClick={() => actions.move(b.task.id, i - 1)}>
                  ↑
                </button>
                <button
                  aria-label={`Move ${b.task.title} later`}
                  disabled={i === blocks.length - 1}
                  onClick={() => actions.move(b.task.id, i + 1)}
                >
                  ↓
                </button>
                <button
                  aria-label={b.task.done ? `Mark ${b.task.title} not finished` : `Mark ${b.task.title} finished`}
                  aria-pressed={b.task.done}
                  onClick={() => actions.setDone(b.task.id, !b.task.done)}
                >
                  ✓
                </button>
                <button aria-label={`Take ${b.task.title} off today`} onClick={() => actions.unplan(b.task.id)}>
                  ×
                </button>
              </div>
            </li>
          ))}
        </ol>

        <form className="plan-add" onSubmit={add}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add a task"
            aria-label="New task for today"
            maxLength={80}
          />
          <LengthSelect value={length} onChange={setLength} />
          <button className="btn btn-solid" type="submit" disabled={!title.trim()}>
            Add
          </button>
        </form>

        {later.length > 0 && (
          <>
            <h3>Not on today</h3>
            <ul className="later-list">
              {later.map((t) => (
                <li key={t.id}>
                  <span className={`dot hue-${t.hue}`} />
                  <span className="later-title">{t.title}</span>
                  <button className="btn" onClick={() => actions.planExisting(t.id)}>
                    Add to today
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
    </>
  );
}
