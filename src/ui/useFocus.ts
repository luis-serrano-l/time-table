import { useEffect, useRef, useState } from 'react';
import type { LogState, Task } from '../log/types';
import { readLocal, writeLocal } from '../store/local';
import { actions } from '../store/store';
import { brief, timeOf } from './format';

/** Away for less than this is a slip of the thumb, not leaving. */
export const GRACE_MS = 10000;
/** Away for longer than this and the task was not interrupted, it was over. */
export const LONG_MS = 60 * 60000;

type Left = { at: number; segStart: number };
export type AwayNote = { text: string; sticky: boolean };

/** The task that should fill the screen: the one running, if it asks for focus. */
export function focusTask(state: LogState): Task | undefined {
  const open = state.open;
  const task = open?.kind === 'task' && open.taskId ? state.tasks.get(open.taskId) : undefined;
  return task?.focus ? task : undefined;
}

/**
 * A web app cannot stop anyone leaving it. This makes leaving count instead:
 * while a focus task runs, time spent outside the app goes into the log as an
 * interruption, and the app says so on the way back in.
 */
export function useFocus(state: LogState, ready: boolean): { note: AwayNote | null; dismiss: () => void } {
  const [note, setNote] = useState<AwayNote | null>(null);
  const live = useRef(state);
  live.current = state;

  useEffect(() => {
    if (!ready) return;

    const leave = () => {
      const s = live.current;
      if (focusTask(s) && s.open) writeLocal('left', { at: Date.now(), segStart: s.open.start } satisfies Left);
    };

    const comeBack = () => {
      const left = readLocal<Left>('left');
      if (!left) return;
      writeLocal('left', null);
      const s = live.current;
      const task = focusTask(s);
      // Only if the same stretch is still running: anything else was settled some other way.
      if (!task || s.open?.start !== left.segStart || left.at < left.segStart) return;
      const gone = Date.now() - left.at;
      if (gone < GRACE_MS) return;
      if (gone >= LONG_MS) {
        actions.stopAt(left.at);
        setNote({ text: `You left at ${timeOf(left.at)} and were gone ${brief(gone)}. ${task.title} was stopped at ${timeOf(left.at)}.`, sticky: true });
      } else {
        actions.away(left.at);
        setNote({ text: `You left for ${brief(gone)}. It is in the log.`, sticky: false });
      }
    };

    const onChange = () => (document.visibilityState === 'hidden' ? leave() : comeBack());
    // The app may have been closed while it was away: settle that on the way in.
    if (document.visibilityState === 'visible') comeBack();
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [ready]);

  useEffect(() => {
    if (!note || note.sticky) return;
    const id = setTimeout(() => setNote(null), 15000);
    return () => clearTimeout(id);
  }, [note]);

  return { note, dismiss: () => setNote(null) };
}
