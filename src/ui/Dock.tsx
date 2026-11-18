import { useState, type FormEvent } from 'react';
import type { LogState } from '../log/types';
import { actions } from '../store/store';
import { clock, dur } from './format';

type Props = { state: LogState; now: number; perTask: Map<string, number> };

/** Pinned to the bottom: what is running, and the two taps that are always there. */
export function Dock({ state, now, perTask }: Props) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const open = state.open;
  const task = open?.taskId ? state.tasks.get(open.taskId) : undefined;
  const parked = state.parked ? state.tasks.get(state.parked) : undefined;
  const elapsed = open ? now - open.start : 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    actions.startNew(t);
    setTitle('');
    setAdding(false);
  }

  if (adding) {
    return (
      <form className="dock dock-add" onSubmit={submit}>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
          placeholder="What are you starting?"
          aria-label="Name of the task to start now"
          maxLength={80}
        />
        <button className="btn btn-solid" type="submit" disabled={!title.trim()}>
          Start
        </button>
        <button className="btn" type="button" onClick={() => setAdding(false)}>
          Cancel
        </button>
      </form>
    );
  }

  return (
    <div className={`dock${open ? ' is-live' : ''}${open?.kind === 'interruption' ? ' is-int' : ''}`}>
      <div className="dock-now" aria-live="off">
        {open?.kind === 'task' && task && (
          <>
            <span className={`dot hue-${task.hue}`} />
            <div className="dock-text">
              <strong>{task.title}</strong>
              <small>{dur(perTask.get(task.id) ?? 0)} today</small>
            </div>
            <time>{clock(elapsed)}</time>
          </>
        )}
        {open?.kind === 'interruption' && (
          <>
            <span className="dot dot-int" />
            <div className="dock-text">
              <strong>Interruption</strong>
              <small>{parked ? `${parked.title} is waiting` : 'Nothing was running'}</small>
            </div>
            <time>{clock(elapsed)}</time>
          </>
        )}
        {!open && (
          <div className="dock-text">
            <strong>Nothing running</strong>
            <small>Tap a task to start it</small>
          </div>
        )}
      </div>
      <div className="dock-actions">
        {open?.kind === 'task' && (
          <button className="btn" onClick={actions.pause}>
            Pause
          </button>
        )}
        {open?.kind === 'interruption' ? (
          <button className="btn btn-solid" onClick={actions.endInterruption}>
            {parked ? 'Back to work' : 'End interruption'}
          </button>
        ) : (
          <button className="btn btn-int" onClick={actions.interrupt}>
            Interruption
          </button>
        )}
        <button className="btn btn-plus" onClick={() => setAdding(true)} aria-label="Start something unplanned">
          +
        </button>
      </div>
    </div>
  );
}
