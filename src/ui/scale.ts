// The timeline's vertical scale. An hour is normally 90px, but an hour that
// holds a very short planned block is drawn taller, so that block stays
// readable and never runs into the next one.

const BASE = 1.5; // px per minute
const MAX = 4.4;
const MIN_BLOCK_PX = 22;

export type Scale = { y(min: number): number; height: number };

export function makeScale(
  fromH: number,
  toH: number,
  blocks: readonly { startMin: number; endMin: number }[],
): Scale {
  const tops: number[] = [0];
  const rates: number[] = [];
  for (let h = fromH; h < toH; h++) {
    let rate = BASE;
    for (const b of blocks) {
      const len = b.endMin - b.startMin;
      if (len > 0 && b.startMin < (h + 1) * 60 && b.endMin > h * 60) {
        rate = Math.max(rate, Math.min(MAX, MIN_BLOCK_PX / len));
      }
    }
    rates.push(rate);
    tops.push(tops[tops.length - 1] + rate * 60);
  }
  const height = tops[tops.length - 1];
  const from = fromH * 60;
  const to = toH * 60;
  return {
    height,
    y(min) {
      if (min <= from) return (min - from) * BASE;
      if (min >= to) return height + (min - to) * BASE;
      const i = Math.floor((min - from) / 60);
      return tops[i] + (min - from - i * 60) * rates[i];
    },
  };
}
