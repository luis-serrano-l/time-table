import type { LogEvent } from '../log/types';

export const FORMAT = 'time-table-log';
export const VERSION = 1;

const TYPES = new Set([
  'task.added',
  'task.edited',
  'task.done',
  'task.removed',
  'plan.set',
  'started',
  'stopped',
  'interruption.started',
  'interruption.ended',
]);

export function toBackup(events: readonly LogEvent[], now: number): string {
  return JSON.stringify(
    { format: FORMAT, version: VERSION, exportedAt: new Date(now).toISOString(), events },
    null,
    1,
  );
}

/** Read a backup file. Throws a message meant for the person, not a stack trace. */
export function fromBackup(text: string): LogEvent[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const d = data as { format?: unknown; version?: unknown; events?: unknown };
  if (d?.format !== FORMAT || !Array.isArray(d.events)) {
    throw new Error('That file is not a time-table backup.');
  }
  if (typeof d.version !== 'number' || d.version > VERSION) {
    throw new Error('That backup was made by a newer version of the app. Update, then import.');
  }
  for (const e of d.events as Record<string, unknown>[]) {
    if (
      typeof e?.id !== 'string' ||
      typeof e.at !== 'number' ||
      !Number.isFinite(e.at) ||
      typeof e.type !== 'string' ||
      !TYPES.has(e.type)
    ) {
      throw new Error('That backup has an entry the app cannot read. Nothing was imported.');
    }
  }
  return d.events as LogEvent[];
}

/** Union of two logs by event id, in time order. Importing twice changes nothing. */
export function mergeLogs(a: readonly LogEvent[], b: readonly LogEvent[]): LogEvent[] {
  const byId = new Map<string, LogEvent>();
  for (const e of a) byId.set(e.id, e);
  for (const e of b) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1));
}
