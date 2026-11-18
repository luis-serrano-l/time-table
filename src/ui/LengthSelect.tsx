import { dur } from './format';

const LENGTHS = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120, 180, 240, 360, 480];

type Props = { value: number; onChange: (min: number) => void; label?: string };

/** How long a task is planned to take. */
export function LengthSelect({ value, onChange, label = 'Length' }: Props) {
  const options = LENGTHS.includes(value) ? LENGTHS : [...LENGTHS, value].sort((a, b) => a - b);
  return (
    <select className="length" aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {options.map((m) => (
        <option key={m} value={m}>
          {dur(m * 60000)}
        </option>
      ))}
    </select>
  );
}
