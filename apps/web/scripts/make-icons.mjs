// Draws the app icons (a white ring on near-black) as PNG files, with no image library.
// Run once: node apps/web/scripts/make-icons.mjs. The output in public/icons is committed.
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

function icon(size, { ringOuter, ringInner }) {
  const bg = [23, 23, 23];
  const fg = [255, 255, 255];
  const rows = [];
  const mid = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - mid, y - mid) / size;
      // The ring has a gap on the right so it reads as a C.
      const inRing = d >= ringInner && d <= ringOuter && !(x > mid && Math.abs(y - mid) < size * 0.1);
      row.set(inRing ? fg : bg, 1 + x * 3);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

const out = join(import.meta.dirname, '..', 'public', 'icons');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'icon-192.png'), icon(192, { ringOuter: 0.36, ringInner: 0.26 }));
writeFileSync(join(out, 'icon-512.png'), icon(512, { ringOuter: 0.36, ringInner: 0.26 }));
// Maskable icons are cropped to a circle by the phone, so the art stays inside the middle 80%.
writeFileSync(join(out, 'maskable-512.png'), icon(512, { ringOuter: 0.28, ringInner: 0.2 }));
process.stdout.write('icons written\n');
