/** "1h 05m", "12m", "0m" */
export function dur(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/** Like dur, without the empty minutes on a whole hour: "40h", "12h 30m" */
export function span(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  return m >= 60 && m % 60 === 0 ? `${m / 60}h` : dur(ms);
}

/** Running clock: "12:05" or "1:12:05" */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return h ? `${h}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`;
}

/** Minutes from midnight to "09:30" */
export function hhmm(min: number): string {
  const m = Math.round(min);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(m / 60) % 24)}:${p(m % 60)}`;
}

export function parseHhmm(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return min < 24 * 60 ? min : null;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Weekdays in the order people read a week: Monday first. */
export const WEEK = [1, 2, 3, 4, 5, 6, 0];
export const dayShort = (d: number) => DAY_NAMES[d];

/** "Every day", "Weekdays", "Mon, Wed" */
export function daysText(days: readonly number[]): string {
  const set = new Set(days);
  if (set.size === 7) return 'Every day';
  if (set.size === 5 && !set.has(0) && !set.has(6)) return 'Weekdays';
  return WEEK.filter((d) => set.has(d))
    .map(dayShort)
    .join(', ');
}

/** A day key as words: { weekday: "Wednesday", date: "November 18" } */
export function dayWords(key: string): { weekday: string; date: string } {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return {
    weekday: date.toLocaleDateString('en', { weekday: 'long' }),
    date: date.toLocaleDateString('en', { day: 'numeric', month: 'long' }),
  };
}
