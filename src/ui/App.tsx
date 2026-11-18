import { useEffect, useState } from 'react';
import { dayKey, daySegments, dayStats, defaultStartMin, planDay } from '../log/day';
import { applyUpdate, useUpdateWaiting } from '../pwa/register';
import { actions, useLog } from '../store/store';
import { DataDialog } from './DataDialog';
import { Dock } from './Dock';
import { dur } from './format';
import { PlanPanel } from './PlanPanel';
import { Timeline } from './Timeline';

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
  const { ready, state, error, count } = useLog();
  const now = useNow();
  const updateWaiting = useUpdateWaiting();
  const [planOpen, setPlanOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);

  const key = dayKey(now);
  const plan = state.plans.get(key);
  const blocks = planDay(state, key, defaultStartMin(now));
  const segs = daySegments(state, key, now);
  const stats = dayStats(segs);

  const date = new Date(now);
  const weekday = date.toLocaleDateString('en', { weekday: 'long' });
  const dayMonth = date.toLocaleDateString('en', { day: 'numeric', month: 'long' });

  if (!ready) return <div className="boot" aria-busy="true" />;

  return (
    <div className="app">
      <header className="top">
        <h1>
          {weekday} <span>{dayMonth}</span>
        </h1>
        <div className="top-actions">
          <button className="btn plan-toggle" onClick={() => setPlanOpen(true)}>
            Plan
          </button>
          <button className="btn" onClick={() => setDataOpen(true)}>
            Data
          </button>
        </div>
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

      {(error || updateWaiting) && (
        <div className="notices">
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
        <Timeline
          state={state}
          blocks={blocks}
          segs={segs}
          perTask={stats.perTask}
          now={now}
          onPlan={() => setPlanOpen(true)}
        />
        <PlanPanel
          state={state}
          plan={plan}
          blocks={blocks}
          perTask={stats.perTask}
          open={planOpen}
          onClose={() => setPlanOpen(false)}
        />
      </main>

      <Dock state={state} now={now} perTask={stats.perTask} />

      {dataOpen && <DataDialog count={count} onClose={() => setDataOpen(false)} />}
    </div>
  );
}
