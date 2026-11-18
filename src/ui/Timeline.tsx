import { useEffect, useRef } from 'react';
import { DEEP_MIN, type DaySegment, type PlanBlock } from '../log/day';
import type { LogState } from '../log/types';
import { actions } from '../store/store';
import { dur, hhmm } from './format';
import { makeScale } from './scale';

/** Below this height a planned block shows on one line. */
const COMPACT_PX = 40;

type Props = {
  state: LogState;
  blocks: PlanBlock[];
  segs: DaySegment[];
  perTask: Map<string, number>;
  now: number;
  onPlan: () => void;
};

export function Timeline({ state, blocks, segs, perTask, now, onPlan }: Props) {
  const d = new Date(now);
  const nowMin = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;

  // Show from an hour before the earliest thing to an hour after the latest,
  // and never less than a working stretch around now.
  const starts = [nowMin - 60, ...blocks.map((b) => b.startMin), ...segs.map((s) => s.startMin)];
  const ends = [nowMin + 240, ...blocks.map((b) => b.endMin), ...segs.map((s) => s.endMin)];
  const fromH = Math.max(0, Math.floor(Math.min(...starts) / 60));
  const toH = Math.min(24, Math.ceil((Math.max(...ends) + 30) / 60));
  // Hours holding very short blocks are drawn taller, so nothing overlaps.
  const { y } = makeScale(fromH, toH, blocks);
  const hours = Array.from({ length: toH - fromH + 1 }, (_, i) => fromH + i);

  // Open with "now" a third of the way down, scrolling only the timeline.
  const scroller = useRef<HTMLElement>(null);
  const nowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scroller.current;
    const line = nowRef.current;
    if (box && line) box.scrollTop = line.offsetTop - box.clientHeight / 3;
  }, []);

  const runningId = state.open?.kind === 'task' ? state.open.taskId : undefined;
  const empty = blocks.length === 0 && segs.length === 0;

  return (
    <section ref={scroller} className="timeline" aria-label="Today">
      <div className="tl-head" aria-hidden="true">
        <span />
        <span>Plan</span>
        <span>What happened</span>
      </div>
      <div className="tl-body" style={{ height: y(toH * 60) }}>
        {hours.map((h) => (
          <div key={h} className="tl-hour" style={{ top: y(h * 60) }}>
            <span>{String(h % 24).padStart(2, '0')}</span>
          </div>
        ))}

        <div className="tl-col tl-plan">
          {blocks.map((b) => {
            const done = perTask.get(b.task.id) ?? 0;
            const running = runningId === b.task.id;
            const over = done > b.lengthMin * 60000;
            const height = y(b.endMin) - y(b.startMin) - 2;
            const compact = height < COMPACT_PX;
            return (
              <button
                key={b.task.id}
                className={`slot hue-${b.task.hue}${running ? ' is-running' : ''}${b.done ? ' is-done' : ''}${compact ? ' is-compact' : ''}`}
                style={{ top: y(b.startMin), height }}
                onClick={() => actions.toggle(b.task.id)}
                aria-pressed={running}
                aria-label={`${b.task.title}, planned ${hhmm(b.startMin)} for ${dur(b.lengthMin * 60000)}, ${dur(done)} logged. ${running ? 'Pause' : 'Start'}`}
              >
                <span className="slot-title">{b.task.title}</span>
                <span className={`slot-meta${over ? ' is-over' : ''}`}>
                  {dur(done)}
                  {compact ? '/' : ' of '}
                  {dur(b.lengthMin * 60000)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="tl-col tl-actual">
          {segs.map((s, i) => {
            const task = s.taskId ? state.tasks.get(s.taskId) : undefined;
            const h = Math.max(3, y(s.endMin) - y(s.startMin));
            const deep = s.kind === 'task' && s.wholeMs >= DEEP_MIN * 60000;
            const label = s.kind === 'interruption' ? 'Interruption' : (task?.title ?? 'Task');
            const cls = `seg ${s.kind === 'interruption' ? 'seg-int' : `hue-${task?.hue ?? 0}`}${s.running ? ' is-running' : ''}${deep ? ' is-deep' : ''}`;
            const style = { top: y(s.startMin), height: h };
            const text = h >= 20 && <span>{label}</span>;
            const title = `${label}, ${hhmm(s.startMin)} to ${s.running ? 'now' : hhmm(s.endMin)}, ${dur(s.end - s.start)}`;
            return task && !task.removed ? (
              <button
                key={i}
                className={cls}
                style={style}
                title={title}
                aria-label={`${title}. ${s.running ? 'Pause' : 'Start again'}`}
                onClick={() => actions.toggle(task.id)}
              >
                {text}
              </button>
            ) : (
              <div key={i} className={cls} style={style} title={title}>
                {text}
              </div>
            );
          })}
        </div>

        <div ref={nowRef} className="tl-now" style={{ top: y(nowMin) }}>
          <span>{hhmm(Math.floor(nowMin))}</span>
        </div>

        {empty && (
          <div className="tl-empty" style={{ top: y(nowMin) + 28 }}>
            <p>Nothing planned and nothing logged yet.</p>
            <button className="btn btn-solid plan-toggle" onClick={onPlan}>
              Plan the day
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
