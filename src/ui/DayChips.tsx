import { dayShort, WEEK } from './format';

type Props = { days: number[]; onChange: (days: number[]) => void };

/** The seven weekdays as toggles, Monday first, with the two usual sets below. */
export function DayChips({ days, onChange }: Props) {
  const flip = (d: number) => onChange(days.includes(d) ? days.filter((x) => x !== d) : [...days, d]);
  return (
    <>
      <div className="days" role="group" aria-label="Days">
        {WEEK.map((d) => (
          <button key={d} type="button" className="day-chip" aria-pressed={days.includes(d)} onClick={() => flip(d)}>
            {dayShort(d)}
          </button>
        ))}
      </div>
      <div className="dialog-row">
        <button type="button" className="btn" onClick={() => onChange([...WEEK])}>
          Every day
        </button>
        <button type="button" className="btn" onClick={() => onChange([1, 2, 3, 4, 5])}>
          Weekdays
        </button>
        <button type="button" className="btn" onClick={() => onChange([])} disabled={!days.length}>
          No days
        </button>
      </div>
    </>
  );
}
