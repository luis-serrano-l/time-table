import { useEffect, useState } from 'react';
import { addDays, dayKey, daySegments, dayStats, resolveDay } from '../log/day';
import type { DayKey } from '../log/types';
import { applyUpdate, useUpdateWaiting } from '../pwa/register';
import { actions, useLog } from '../store/store';
import { DataDialog } from './DataDialog';
import { Dock } from './Dock';
import { Focus } from './Focus';
import { dayWords, dur } from './format';
import { DayLog } from './DayLog';
import { StalePrompt } from './StalePrompt';
import { focusTask, useFocus } from './useFocus';
import { useStale } from './useStale';
import { TaskList } from './TaskList';

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return now;
}

export function App() {
  const { ready, state, error, count, undo } = useLog();
  const now = useNow();
  const updateWaiting = useUpdateWaiting();
  const [dataOpen, setDataOpen] = useState(false);

  // Null follows today, so the view rolls over at midnight by itself.
  const [viewDay, setViewDay] = useState<DayKey | null>(null);

  const today = dayKey(now);
  const day = viewDay ?? today;
  const isToday = day === today;
  const entries = resolveDay(state, day, today);
  const segs = daySegments(state, day, now);
  const stats = dayStats(segs);
  // The dock always talks about now, whatever day is on screen.
  const todayStats = isToday ? stats : dayStats(daySegments(state, today, now));
  const { weekday, date } = dayWords(day);

  // Is the running timer one that was forgotten?
  const runningId = state.open?.kind === 'task' ? state.open.taskId : undefined;
  const running = runningId ? state.tasks.get(runningId) : undefined;
  const { stale, stillWorking } = useStale(
    state,
    now,
    ready,
    running?.estimateMin ?? undefined,
    running && (todayStats.perTask.get(running.id) ?? 0),
  );
  const away = useFocus(state, ready);
  const focused = focusTask(state);
  const go = (d: DayKey) => setViewDay(d === today ? null : d);

  if (!ready) return <div className="boot" aria-busy="true" />;

  // A focus task takes the screen, unless the app needs to ask about a forgotten timer.
  if (focused && !stale) {
    return <Focus state={state} task={focused} now={now} ms={todayStats.perTask.get(focused.id) ?? 0} note={away.note?.text} />;
  }

  return (
    <div className="app">
      <header className="top">
        <div className="top-day">
          <button className="nav" aria-label="Previous day" onClick={() => go(addDays(day, -1))}>
            <svg viewBox="0 0 12 20" aria-hidden="true">
              <path d="M9.5 2.5 3 10l6.5 7.5" />
            </svg>
          </button>
          <h1>
            {weekday} <span>{date}</span>
          </h1>
          <button className="nav" aria-label="Next day" onClick={() => go(addDays(day, 1))}>
            <svg viewBox="0 0 12 20" aria-hidden="true">
              <path d="M2.5 2.5 9 10l-6.5 7.5" />
            </svg>
          </button>
        </div>
        <div className="top-actions">
          <button className="btn" onClick={() => setDataOpen(true)}>
            Data
          </button>
        </div>
        {!isToday && (
          <button className="btn btn-today" onClick={() => setViewDay(null)}>
            Back to today
          </button>
        )}
        <dl className="tally">
          <div>
            <dt>Logged</dt>
            <dd>{dur(stats.trackedMs)}</dd>
          </div>
          <div>
            <dt>Switches</dt>
            <dd>{stats.switches}</dd>
          </div>
          <div>
            <dt>Interruptions</dt>
            <dd>
              {stats.interruptions}
              {stats.interruptedMs >= 60000 && <small> {dur(stats.interruptedMs)}</small>}
            </dd>
          </div>
          <div>
            <dt>Deep stretches</dt>
            <dd>{stats.deepStretches}</dd>
          </div>
        </dl>
      </header>

      {(error || updateWaiting || stale || away.note) && (
        <div className="notices">
          {stale && (
            <StalePrompt
              key={stale.segStart}
              stale={stale}
              title={running?.title ?? 'the interruption'}
              now={now}
              onStillWorking={stillWorking}
            />
          )}
          {away.note && (
            <p className="notice" role="status">
              {away.note.text}
              <button className="btn" onClick={away.dismiss}>
                OK
              </button>
            </p>
          )}
          {error && (
            <p className="notice notice-bad" role="alert">
              {error}
              <button className="btn" onClick={actions.dismissError}>
                Dismiss
              </button>
            </p>
          )}
          {updateWaiting && (
            <p className="notice">
              A new version is ready.
              <button className="btn" onClick={applyUpdate}>
                Update
              </button>
            </p>
          )}
        </div>
      )}

      <main className="day">
        <TaskList
          state={state}
          day={day}
          today={today}
          dayName={isToday ? 'today' : weekday}
          now={now}
          entries={entries}
          perTask={stats.perTask}
        />
        <DayLog state={state} day={day} today={today} now={now} segs={segs} />
      </main>

      {undo && (
        <div className="toast" role="status">
          <span>{undo}</span>
          <button className="btn" onClick={actions.undo}>
            Undo
          </button>
        </div>
      )}

      <Dock state={state} now={now} perTask={todayStats.perTask} />

      {dataOpen && <DataDialog count={count} onClose={() => setDataOpen(false)} />}
    </div>
  );
}
