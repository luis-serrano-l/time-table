import { describe, expect, it } from 'vitest';
import { makeScale } from './scale';

const block = (startMin: number, len: number) => ({ startMin, endMin: startMin + len });

describe('timeline scale', () => {
  it('an hour without short blocks keeps its normal height', () => {
    const s = makeScale(8, 12, [block(540, 30), block(570, 60)]);
    expect(s.y(600) - s.y(540)).toBe(90);
    expect(s.height).toBe(360);
  });

  it('a 5-minute block is at least 20px tall', () => {
    const s = makeScale(8, 12, [block(545, 5)]);
    expect(s.y(550) - s.y(545) - 2).toBeGreaterThanOrEqual(20 - 1e-6);
    // Only that hour grows.
    expect(s.y(540) - s.y(480)).toBe(90);
    expect(s.y(660) - s.y(600)).toBe(90);
  });

  it('y is continuous and increasing across hours', () => {
    const s = makeScale(8, 12, [block(595, 5), block(600, 10)]);
    let prev = s.y(470);
    for (let m = 471; m <= 730; m++) {
      const y = s.y(m);
      expect(y).toBeGreaterThan(prev);
      expect(y - prev).toBeLessThanOrEqual(4.4 + 1e-9);
      prev = y;
    }
  });

  it('consecutive blocks of any length from 5 minutes never overlap', () => {
    const lens = [5, 10, 5, 15, 30, 5, 60, 10];
    const blocks: { startMin: number; endMin: number }[] = [];
    let at = 535;
    for (const len of lens) {
      blocks.push(block(at, len));
      at += len;
    }
    const s = makeScale(8, 12, blocks);
    for (let i = 0; i < blocks.length; i++) {
      const height = s.y(blocks[i].endMin) - s.y(blocks[i].startMin) - 2;
      expect(height).toBeGreaterThanOrEqual(20 - 1e-6);
      if (i) expect(s.y(blocks[i].startMin)).toBeGreaterThanOrEqual(s.y(blocks[i - 1].startMin) + (s.y(blocks[i - 1].endMin) - s.y(blocks[i - 1].startMin) - 2));
    }
  });
});
