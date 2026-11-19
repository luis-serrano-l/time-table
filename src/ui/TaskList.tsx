import { useState, type FormEvent } from 'react';
import { activeRule, isRepeating, looseTasks, type DayEntry } from '../log/day';
import { projectProgress } from '../log/project';
import type { DayKey, LogState, Task } from '../log/types';
import { actions } from '../store/store';
import { daysText, span } from './format';
import { TaskCard } from './TaskCard';
import { TaskDialog } from './TaskDialog';
import { useDragSort } from './useDragSort';

type Props = {
  state: LogState;
  day: DayKey;
  today: DayKey;
  /** "today", or the weekday on screen. */
  dayName: string;
  now: number;
  entries: DayEntry[];
  perTask: Map<string, number>;
};

/** The tasks on a day: what to do, a way to add more, and what is already done. */
export function TaskList({ state, day, today, dayName, now, entries, perTask }: Props) {
  const [title, setTitle] = useState('');
  const [dialog, setDialog] = useState<{ task?: Task; title?: string } | null>(null);
  // Until it is folded or unfolded by hand, Done is open when nothing else is left to do.
  const [doneOpen, setDoneOpen] = useState<boolean | null>(null);
  const [showOther, setShowOther] = useState(false);

  const isToday = day === today;
  const past = day < today;
  const mode = past ? 'past' : isToday ? 'run' : 'plan';
  const runningId = isToday && state.open?.kind === 'task' ? state.open.taskId : undefined;

  const todo = entries.filter((e) => !e.done);
  const done = entries.filter((e) => e.done);
  const showDone = doneOpen ?? (isToday && todo.length === 0);
  const running = todo.find((e) => e.task.id === runningId);
  const waiting = todo.filter((e) => e !== running);
  const waitingIds = waiting.map((e) => e.task.id);

  // The running card sits on top, out of the order, so it keeps its place among the rest.
  const sort = useDragSort(waitingIds, (ids) => {
    let k = 0;
    actions.reorder(day, [...todo.map((e) => (e === running ? e.task.id : ids[k++])), ...done.map((e) => e.task.id)]);
  });

  const onDay = new Set(entries.map((e) => e.task.id));
  const loose = new Set(looseTasks(state, today).map((t) => t.id));
  const other = past
    ? []
    : [...state.tasks.values()].filter(
        (t) => !t.removed && !t.done && !onDay.has(t.id) && (loose.has(t.id) || isRepeating(state, t.id)),
      );

  function add(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    actions.addTask(day, { title: t, estimateMin: null, days: [], budgetMin: null, focus: false });
    setTitle('');
  }

  const card = (e: DayEntry, extra: Partial<Parameters<typeof TaskCard>[0]> = {}) => (
    <TaskCard
      key={e.task.id}
      state={state}
      entry={e}
      day={day}
      now={now}
      ms={perTask.get(e.task.id) ?? 0}
      mode={mode}
      onMore={past ? undefined : () => setDialog({ task: e.task })}
      {...extra}
    />
  );

  return (
    <section className="tasks" aria-label={`Tasks for ${dayName}`}>
      {entries.length === 0 && (
        <p className="empty">
          {past ? 'Nothing was on that day.' : `Nothing on ${dayName} yet. Name a task below, then tap it to start.`}
        </p>
      )}
      {todo.length === 0 && done.length > 0 && !past && <p className="empty">Everything on {dayName} is done.</p>}

      <ul className={`cards${sort.dragging ? ' is-sorting' : ''}`}>
        {running && card(running, { running: true })}
        {waiting.map((e) =>
          card(
            e,
            past
              ? {}
              : {
                  drag: {
                    ref: sort.itemRef(e.task.id),
                    style: sort.itemStyle(e.task.id),
                    grip: sort.gripProps(e.task.id),
                    lifted: sort.dragging === e.task.id,
                  },
                },
          ),
        )}
      </ul>

      {!past && (
        <form className="add" onSubmit={add}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`Add a task for ${dayName}`}
            aria-label={`Name of a task for ${dayName}`}
            maxLength={80}
          />
          <button className="btn btn-solid" type="submit" disabled={!title.trim()}>
            Add
          </button>
          <button
            className="btn"
            type="button"
            aria-label="More options for the new task: estimate, repeat, project"
            onClick={() => {
              setDialog({ title: title.trim() });
              setTitle('');
            }}
          >
            Options
          </button>
        </form>
      )}

      {done.length > 0 && (
        <>
          <button className="fold" aria-expanded={showDone} onClick={() => setDoneOpen(!showDone)}>
            Done <span>{done.length}</span>
          </button>
          {showDone && <ul className="cards">{done.map((e) => card(e))}</ul>}
        </>
      )}

      {other.length > 0 && (
        <>
          <button className="fold" aria-expanded={showOther} onClick={() => setShowOther(!showOther)}>
            Not on {dayName} <span>{other.length}</span>
          </button>
          {showOther && (
            <ul className="other">
              {other.map((t) => {
                const rule = activeRule(state, t.id);
                const p = projectProgress(state, t.id, now);
                const notes = [p && `${span(p.spentMs)} of ${span(p.budgetMs)}`, rule ? daysText(rule.days) : 'No set days'];
                return (
                  <li key={t.id}>
                    <span className={`dot hue-${t.hue}`} />
                    <span className="other-title">
                      {t.title}
                      <small>{notes.filter(Boolean).join(', ')}</small>
                    </span>
                    <button className="btn" aria-label={`Put ${t.title} on ${dayName}`} onClick={() => actions.planExisting(day, t.id)}>
                      Put on {dayName}
                    </button>
                    <button className="btn" aria-label={`Change ${t.title}`} onClick={() => setDialog({ task: t })}>
                      Change
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {dialog && (
        <TaskDialog
          state={state}
          task={dialog.task}
          title={dialog.title}
          day={day}
          today={today}
          dayName={dayName}
          onDay={!!dialog.task && onDay.has(dialog.task.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
