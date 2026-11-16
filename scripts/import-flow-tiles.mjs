// Turns the floor tile sheet made in Google Flow into apps/web/public/office/tiles.png (eight 32 by 32 tiles in one row).
// Run after `node scripts/make-office.mjs`:  node scripts/import-flow-tiles.mjs
//
// art-source/flow/tiles.png holds eight square swatches, 4 columns by 2 rows, on a black background, in the order of the map's tile
// ids in the sheet: stone, wall, carpet, wood, lounge, door, desk, cream tile (see PICK for how they map to the tile ids). From each swatch the middle part is cut (so a swatch's own border is not
// used) and shrunk to a tile with nearest neighbour. No sheet: the tiles drawn by make-office.mjs stay.
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const file = path.join(root, 'art-source', 'flow', 'tiles.png');
const out = path.join(root, 'apps', 'web', 'public', 'office', 'tiles.png');
const T = 32;
// Which swatch becomes each tile id (floor, wall, carpet, wood, lounge, door, desk, thing). The cream tile is the hall floor and also the tile under objects, so they sit on the floor without a patch.
const PICK = [7, 1, 2, 3, 4, 5, 6, 7];
const KEEP = 0.56; // the share of each swatch, from its middle, that becomes the tile

function bands(counts, minRun) {
  const res = [];
  let start = -1;
  for (let i = 0; i <= counts.length; i++) {
    const on = i < counts.length && counts[i] > 0;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if (i - start >= minRun) res.push([start, i - 1]);
      start = -1;
    }
  }
  return res;
}

if (!existsSync(file)) {
  process.stdout.write('no art-source/flow/tiles.png: nothing to import\n');
  process.exit(0);
}
const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;
const lit = (x, y) => data[(y * w + x) * 4] + data[(y * w + x) * 4 + 1] + data[(y * w + x) * 4 + 2] > 90;
const rowCounts = Array.from({ length: h }, (_, y) => {
  let n = 0;
  for (let x = 0; x < w; x++) n += lit(x, y) ? 1 : 0;
  return n;
});
const rows = bands(rowCounts, 60);
if (rows.length !== 2) throw new Error(`found ${rows.length} rows of swatches, expected 2`);
const swatches = [];
for (const [y0, y1] of rows) {
  const colCounts = Array.from({ length: w }, (_, x) => {
    let n = 0;
    for (let y = y0; y <= y1; y++) n += lit(x, y) ? 1 : 0;
    return n;
  });
  const cols = bands(colCounts, 60);
  if (cols.length !== 4) throw new Error(`a row has ${cols.length} swatches, expected 4`);
  for (const [x0, x1] of cols) swatches.push({ x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
}
const sheet = Buffer.alloc(T * 8 * T * 4);
for (let i = 0; i < 8; i++) {
  const s = swatches[PICK[i]];
  const cw = Math.round(s.w * KEEP);
  const ch = Math.round(s.h * KEEP);
  const left = s.x0 + Math.round((s.w - cw) / 2);
  const top = s.y0 + Math.round((s.h - ch) / 2);
  const tile = await sharp(file).extract({ left, top, width: cw, height: ch }).resize(T, T, { kernel: 'nearest' }).removeAlpha().raw().toBuffer();
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const d = (y * T * 8 + i * T + x) * 4;
      const o = (y * T + x) * 3;
      sheet[d] = tile[o];
      sheet[d + 1] = tile[o + 1];
      sheet[d + 2] = tile[o + 2];
      sheet[d + 3] = 255;
    }
}
await sharp(sheet, { raw: { width: T * 8, height: T, channels: 4 } }).png().toFile(out);
process.stdout.write('wrote tiles.png\n');
