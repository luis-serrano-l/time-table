import { useState } from 'react';
import { carryOver } from '../log/day';
import type { DayKey, LogState } from '../log/types';
import { readLocal, writeLocal } from '../store/local';
import { actions } from '../store/store';
import { dayWords } from './format';

type Props = { state: LogState; today: DayKey };

/** What was planned last time and not finished, offered for today. */
export function CarryOver({ state, today }: Props) {
  const [dismissed, setDismissed] = useState(() => readLocal<DayKey>('carry-dismissed'));
  const carry = carryOver(state, today);
  if (!carry || dismissed === today) return null;
  const n = carry.tasks.length;

  return (
    <section className="carry" aria-label="Unfinished tasks">
      <div className="carry-head">
        <strong>
          From {dayWords(carry.from).weekday}: {n} unfinished
        </strong>
        <button className="btn btn-solid" onClick={() => actions.planMany(today, carry.tasks.map((t) => t.id))}>
          Add all
        </button>
        <button
          className="btn"
          onClick={() => {
            writeLocal('carry-dismissed', today);
            setDismissed(today);
          }}
        >
          Dismiss
        </button>
      </div>
      <ul>
        {carry.tasks.map((t) => (
          <li key={t.id}>
            <span className={`dot hue-${t.hue}`} />
            <span className="later-title">{t.title}</span>
            <button className="btn" aria-label={`Bring back ${t.title}`} onClick={() => actions.planExisting(today, t.id)}>
              Bring back
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
