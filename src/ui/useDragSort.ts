import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

type Drag = { id: string; from: number; to: number; dy: number; startY: number; tops: number[]; heights: number[]; gap: number };

/**
 * Reorder a vertical list by dragging a grip. The dragged item follows the
 * pointer and the others make room. Arrow keys on the grip do the same job.
 */
export function useDragSort(ids: readonly string[], onSort: (ids: string[]) => void) {
  const items = useRef(new Map<string, HTMLElement>());
  const [drag, setDrag] = useState<Drag | null>(null);

  const moved = (from: number, to: number) => {
    const next = [...ids];
    next.splice(to, 0, ...next.splice(from, 1));
    return next;
  };

  function down(id: string, e: PointerEvent<HTMLElement>) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const rects = ids.map((x) => items.current.get(x)?.getBoundingClientRect());
    if (rects.some((r) => !r)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const tops = rects.map((r) => r!.top);
    const heights = rects.map((r) => r!.height);
    const from = ids.indexOf(id);
    const gap = tops.length > 1 ? tops[1] - tops[0] - heights[0] : 0;
    setDrag({ id, from, to: from, dy: 0, startY: e.clientY, tops, heights, gap });
  }

  function move(e: PointerEvent<HTMLElement>) {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    const mid = drag.tops[drag.from] + drag.heights[drag.from] / 2 + dy;
    // The slot whose middle the dragged item's middle has passed.
    let to = drag.from;
    for (let i = 0; i < ids.length; i++) {
      const m = drag.tops[i] + drag.heights[i] / 2;
      if (i < drag.from && mid < m) {
        to = i;
        break;
      }
      if (i > drag.from && mid > m) to = i;
    }
    setDrag({ ...drag, dy, to });
  }

  function up() {
    if (!drag) return;
    setDrag(null);
    if (drag.to !== drag.from) onSort(moved(drag.from, drag.to));
  }

  function key(id: string, e: KeyboardEvent<HTMLElement>) {
    const by = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    const i = ids.indexOf(id);
    if (!by || i + by < 0 || i + by >= ids.length) return;
    e.preventDefault();
    onSort(moved(i, i + by));
  }

  return {
    dragging: drag?.id ?? null,
    itemRef: (id: string) => (el: HTMLElement | null) => {
      if (el) items.current.set(id, el);
      else items.current.delete(id);
    },
    itemStyle(id: string): CSSProperties | undefined {
      if (!drag) return undefined;
      const i = ids.indexOf(id);
      if (id === drag.id) return { transform: `translateY(${drag.dy}px)`, zIndex: 2, transition: 'none' };
      const step = drag.heights[drag.from] + drag.gap;
      if (drag.to > drag.from && i > drag.from && i <= drag.to) return { transform: `translateY(${-step}px)` };
      if (drag.to < drag.from && i < drag.from && i >= drag.to) return { transform: `translateY(${step}px)` };
      return { transform: 'none' };
    },
    gripProps: (id: string) => ({
      onPointerDown: (e: PointerEvent<HTMLElement>) => down(id, e),
      onPointerMove: move,
      onPointerUp: up,
      onPointerCancel: () => setDrag(null),
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => key(id, e),
    }),
  };
}
