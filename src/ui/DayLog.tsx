import { useState } from 'react';
import { DEEP_MIN, type DaySegment } from '../log/day';
import type { DayKey, LogState } from '../log/types';
import { dur, timeOf } from './format';
import { EntryDialog } from './EntryDialog';

type Props = { state: LogState; day: DayKey; today: DayKey; now: number; segs: DaySegment[] };

/** What was actually done on the day, in order, with the times it happened. */
export function DayLog({ state, day, today, now, segs }: Props) {
  const [dialog, setDialog] = useState<{ segId?: string } | null>(null);
  const canAdd = day <= today && [...state.tasks.values()].some((t) => !t.removed);

  return (
    <section className="log" aria-label="What happened">
      <div className="log-head">
        <h2>What happened</h2>
        {canAdd && (
          <button className="btn" onClick={() => setDialog({})}>
            Add entry
          </button>
        )}
      </div>
      {segs.length === 0 && (
        <p className="empty">
          {day > today ? 'This day has not come yet.' : day === today ? 'Nothing logged yet. Times appear here once you start a task.' : 'Nothing was logged that day.'}
        </p>
      )}
      <ol className="log-list">
        {segs.map((s) => {
          const task = s.taskId ? state.tasks.get(s.taskId) : undefined;
          const what = s.kind === 'interruption' ? 'Interruption' : (task?.title ?? 'Task');
          const deep = s.kind === 'task' && s.wholeMs >= DEEP_MIN * 60000;
          const from = timeOf(s.start);
          const to = s.running ? 'now' : timeOf(s.end);
          return (
            <li key={s.id}>
              <button
                className={`log-row${s.kind === 'interruption' ? ' is-int' : ` hue-${task?.hue ?? 0}`}${s.running ? ' is-running' : ''}`}
                aria-label={`${what}, ${from} to ${to}, ${dur(s.end - s.start)}${deep ? ', a deep stretch' : ''}. Change`}
                onClick={() => setDialog({ segId: s.id })}
              >
                <span className="log-time">
                  {from}
                  <i>to</i>
                  {to}
                </span>
                <span className={`dot${s.kind === 'interruption' ? ' dot-int' : ''}`} />
                <span className="log-what">{what}</span>
                {deep && <span className="log-deep">deep</span>}
                <span className="log-dur">{dur(s.end - s.start)}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {dialog && <EntryDialog state={state} day={day} now={now} segId={dialog.segId} onClose={() => setDialog(null)} />}
    </section>
  );
}
