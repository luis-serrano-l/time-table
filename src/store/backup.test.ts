import { describe, expect, it } from 'vitest';
import type { LogEvent } from '../log/types';
import { fromBackup, mergeLogs, toBackup } from './backup';

const a: LogEvent = { id: 'a', at: 1, type: 'task.added', taskId: 't', title: 'T', estimateMin: 30 };
const b: LogEvent = { id: 'b', at: 2, type: 'started', taskId: 't' };
const c: LogEvent = { id: 'c', at: 3, type: 'stopped' };

describe('backup', () => {
  it('round-trips the log', () => {
    expect(fromBackup(toBackup([a, b, c], 0))).toEqual([a, b, c]);
  });

  it('refuses files that are not a backup, with a plain message', () => {
    expect(() => fromBackup('not json')).toThrow('not valid JSON');
    expect(() => fromBackup('{"events":[]}')).toThrow('not a time-table backup');
    expect(() => fromBackup(JSON.stringify({ format: 'time-table-log', version: 99, events: [] }))).toThrow(
      'newer version',
    );
    expect(() =>
      fromBackup(JSON.stringify({ format: 'time-table-log', version: 1, events: [{ id: 'x', at: 'soon', type: 'stopped' }] })),
    ).toThrow('cannot read');
  });

  it('accepts v1 and v2 files and still refuses a newer one', () => {
    const file = (version: number) => JSON.stringify({ format: 'time-table-log', version, events: [a] });
    expect(fromBackup(file(1))).toEqual([a]);
    expect(fromBackup(file(2))).toEqual([a]);
    expect(() => fromBackup(file(3))).toThrow('newer version');
  });

  it('round-trips the newer kinds of entry', () => {
    const events: LogEvent[] = [
      a,
      { id: 'd', at: 4, type: 'entry.set', day: '2026-11-18', taskId: 't', lengthMin: 20, pinMin: null },
      { id: 'e', at: 5, type: 'rule.set', taskId: 't', from: '2026-11-18', days: [1, 3], atMin: 600, lengthMin: 15 },
      { id: 'f', at: 6, type: 'project.set', taskId: 't', budgetMin: 2400 },
      { id: 'g', at: 7, type: 'trimmed', segStart: 2, endAt: 3 },
      { id: 'h', at: 8, type: 'stopped', endAt: 7 },
    ];
    expect(fromBackup(toBackup(events, 0))).toEqual(events);
  });

  it('merges by id, in time order, and is idempotent', () => {
    const merged = mergeLogs([c, a], [b, a]);
    expect(merged.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(mergeLogs(merged, [a, b, c])).toEqual(merged);
  });
});
