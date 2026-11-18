import { useState } from 'react';
import { dayRange, dayKey } from '../log/day';
import type { Stale } from '../log/stale';
import { actions } from '../store/store';
import { dur, hhmm, parseHhmm } from './format';

type Props = { stale: Stale; title: string; now: number; onStillWorking: () => void };

/** Asks about a timer that looks forgotten. It never stops one by itself. */
export function StalePrompt({ stale, title, now, onStillWorking }: Props) {
  const guess = new Date(stale.suggestedEnd);
  const [time, setTime] = useState(hhmm(guess.getHours() * 60 + guess.getMinutes()));

  function setEnd() {
    const min = parseHhmm(time);
    if (min === null) return;
    // The time is read as today's; one still ahead of now means yesterday evening.
    let at = dayRange(dayKey(now))[0] + min * 60000;
    if (at > now) at -= 24 * 60 * 60000;
    actions.stopAt(at);
  }

  return (
    <div className="notice notice-ask" role="status">
      <p>
        <strong>Still on {title}?</strong>{' '}
        {stale.reason === 'gap'
          ? `The timer kept running while the app was closed: ${dur(now - stale.segStart)} so far.`
          : `It has run well past its planned time: ${dur(now - stale.segStart)} in this stretch.`}
      </p>
      <div className="notice-row">
        <button className="btn btn-solid" onClick={onStillWorking}>
          Still working
        </button>
        <button className="btn" onClick={actions.pause}>
          Stop now
        </button>
        <label>
          It ended at
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <button className="btn" onClick={setEnd} disabled={parseHhmm(time) === null}>
          Set end
        </button>
      </div>
    </div>
  );
}
