/** "1h 05m", "12m", "0m" */
export function dur(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
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
