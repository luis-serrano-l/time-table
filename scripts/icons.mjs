// Draws the PNG app icons with no image tools: the same rectangles as
// public/icon.svg, rasterised by hand. Run: node scripts/icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const NAVY = hex('#13293d');

// [x, y, w, h, radius, colour, strokeWidth (0 = filled)] on a 512 grid
const SHAPES = [
  [120, 104, 120, 96, 18, hex('#9fb3c6'), 14],
  [120, 224, 120, 184, 18, hex('#9fb3c6'), 14],
  [272, 104, 120, 140, 18, hex('#3fa7a0'), 0],
  [272, 262, 120, 74, 18, hex('#f0b429'), 0],
  [88, 352, 336, 16, 8, hex('#ff4d8d'), 0],
];

function inside(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function colourAt(px, py, corner, scale) {
  // scale < 1 shrinks the drawing towards the centre (maskable safe zone)
  const u = (px - 256) / scale + 256;
  const v = (py - 256) / scale + 256;
  if (!inside(px, py, 0, 0, 512, 512, corner)) return null;
  let c = NAVY;
  for (const [x, y, w, h, r, col, sw] of SHAPES) {
    if (sw === 0) {
      if (inside(u, v, x, y, w, h, r)) c = col;
    } else if (
      inside(u, v, x - sw / 2, y - sw / 2, w + sw, h + sw, r + sw / 2) &&
      !inside(u, v, x + sw / 2, y + sw / 2, w - sw, h - sw, Math.max(0, r - sw / 2))
    ) {
      c = col;
    }
  }
  return c;
}

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, corner, scale) {
  const SS = 3; // supersampling per axis
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const c = colourAt(((x + (sx + 0.5) / SS) * 512) / size, ((y + (sy + 0.5) / SS) * 512) / size, corner, scale);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      const o = row + 1 + x * 4;
      if (a) { raw[o] = r / a; raw[o + 1] = g / a; raw[o + 2] = b / a; }
      raw[o + 3] = (a * 255) / (SS * SS);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync('public/icon-192.png', png(192, 112, 1));
writeFileSync('public/icon-512.png', png(512, 112, 1));
writeFileSync('public/icon-maskable-512.png', png(512, 0, 0.72));
console.log('icons written');
