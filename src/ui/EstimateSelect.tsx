import { dur } from './format';

const LENGTHS = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120, 180, 240, 360, 480];

type Props = { value: number | null; onChange: (min: number | null) => void };

/** How long a task is expected to take. Nobody has to say. */
export function EstimateSelect({ value, onChange }: Props) {
  const options = value === null || LENGTHS.includes(value) ? LENGTHS : [...LENGTHS, value].sort((a, b) => a - b);
  return (
    <select
      className="length"
      aria-label="Estimate"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">No estimate</option>
      {options.map((m) => (
        <option key={m} value={m}>
          {dur(m * 60000)}
        </option>
      ))}
    </select>
  );
}
