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

  it('merges by id, in time order, and is idempotent', () => {
    const merged = mergeLogs([c, a], [b, a]);
    expect(merged.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(mergeLogs(merged, [a, b, c])).toEqual(merged);
  });
});
