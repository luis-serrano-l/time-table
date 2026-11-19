import { useEffect } from 'react';
import { isRepeating } from '../log/day';
import { projectProgress } from '../log/project';
import type { LogState, Task } from '../log/types';
import { actions } from '../store/store';
import { clock, dur, span } from './format';

type Props = { state: LogState; task: Task; now: number; ms: number; note?: string };

/** Best effort: hide the browser and keep the screen on. Either may be refused. */
function useHoldScreen() {
  useEffect(() => {
    let gone = false;
    let lock: WakeLockSentinel | null = null;
    const hold = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock
        ?.request('screen')
        .then((l) => {
          if (gone) void l.release();
          else lock = l;
        })
        .catch(() => {});
    };
    hold();
    document.addEventListener('visibilitychange', hold);
    try {
      void document.documentElement.requestFullscreen?.()?.catch(() => {});
    } catch {
      // Not allowed here. The view still covers the page.
    }
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', hold);
      void lock?.release().catch(() => {});
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);
}

/** A focus task takes the whole screen. The only ways out are the three buttons. */
export function Focus({ state, task, now, ms, note }: Props) {
  useHoldScreen();
  const open = state.open;
  const project = projectProgress(state, task.id, now);
  const over = task.estimateMin !== null && ms > task.estimateMin * 60000;

  return (
    <main className={`focus hue-${task.hue}`} aria-label={`Focus on ${task.title}`}>
      <div className="focus-body">
        <h1>{task.title}</h1>
        <time>{clock(open ? now - open.start : 0)}</time>
        <p className={over ? 'is-over' : ''}>
          {dur(ms)} today
          {task.estimateMin !== null && ` of ${dur(task.estimateMin * 60000)}`}
          {project && `, ${span(project.spentMs)} of ${span(project.budgetMs)}`}
        </p>
        <p className="focus-note" role="status">
          {note ?? 'If you leave the app, the time away is logged as an interruption.'}
        </p>
      </div>
      <div className="focus-actions">
        <button className="btn" onClick={actions.pause}>
          Pause
        </button>
        <button className="btn btn-solid" onClick={actions.finish}>
          {isRepeating(state, task.id) ? 'Done for today' : 'Finish'}
        </button>
        <button className="btn btn-int" onClick={actions.interrupt}>
          Interruption
        </button>
      </div>
    </main>
  );
}
