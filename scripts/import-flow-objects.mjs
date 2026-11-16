// Turns the furniture sheets made in Google Flow into apps/web/public/office/objects.png, one 32 by 32 picture for each object type
// in the order of OBJECT_TYPES. Run after `node scripts/make-sprites.mjs`:  node scripts/import-flow-objects.mjs
//
// art-source/flow/objects-a.png holds objects 0 to 7 and objects-b.png holds 8 to 15, each as 4 columns by 2 rows on a plain
// background. The background colour is taken from the corners; the pale floor shadows under each object are removed too, so only the
// object stays. Each object is shrunk to fit a 30 by 30 box (nearest neighbour, so the pixels stay crisp) and stands on the bottom
// edge of its frame. A missing sheet leaves those objects as drawn by make-sprites.mjs.
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'art-source', 'flow');
const outPath = path.join(root, 'apps', 'web', 'public', 'office', 'objects.png');
const F = 32;
const FIT = 30;
const KERNEL = process.env.FLOW_KERNEL ?? 'nearest';

function bands(counts, minRun, gapMin = 6) {
  const out = [];
  let start = -1;
  let gap = 0;
  for (let i = 0; i <= counts.length; i++) {
    const on = i < counts.length && counts[i] > 0;
    if (on) {
      if (start < 0) start = i;
      gap = 0;
    } else if (start >= 0) {
      gap++;
      if (gap >= gapMin || i === counts.length) {
        const end = i - gap;
        if (end - start + 1 >= minRun) out.push([start, end]);
        start = -1;
        gap = 0;
      }
    }
  }
  return out;
}

async function cells(file, cols, rows, colsFirst = false) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const at = (x, y) => (y * w + x) * 4;
  const corners = [at(2, 2), at(w - 3, 2), at(2, h - 3), at(w - 3, h - 3)];
  const bg = [0, 1, 2].map((i) => Math.round(corners.reduce((s, o) => s + data[o + i], 0) / 4));
  const bgLum = (bg[0] + bg[1] + bg[2]) / 3;
  const fg = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = at(x, y);
      const r = data[o], g = data[o + 1], b = data[o + 2];
      const d = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);
      const lum = (r + g + b) / 3;
      const grey = Math.max(r, g, b) - Math.min(r, g, b) < 22;
      // The background, and the soft grey shadow on it (grey, darker than the background but not as dark as an outline).
      const shadow = grey && lum < bgLum + 12 && lum > 70;
      if (d > 60 && !shadow) fg[y * w + x] = 1;
    }
  // The boxes to cut, row by row. Normally rows are found first. With `colsFirst` the columns are found first and the rows inside each
  // column, for a sheet whose objects in one row do not line up (a tall tree beside a small plant).
  const boxes = [];
  const rowsOf = (x0, x1) => {
    const counts = Array.from({ length: h }, (_, y) => {
      let n = 0;
      for (let x = x0; x <= x1; x++) n += fg[y * w + x];
      return n;
    });
    return bands(counts, 30, 20);
  };
  const colsOf = (y0, y1) => {
    const counts = Array.from({ length: w }, (_, x) => {
      let n = 0;
      for (let y = y0; y <= y1; y++) n += fg[y * w + x];
      return n;
    });
    return bands(counts, 30, 20);
  };
  if (colsFirst) {
    const cb = colsOf(0, h - 1);
    if (cb.length !== cols) throw new Error(`${file}: found ${cb.length} columns of objects, expected ${cols}`);
    const grid = cb.map(([x0, x1]) => {
      const rb = rowsOf(x0, x1);
      if (rb.length !== rows) throw new Error(`${file}: a column has ${rb.length} objects, expected ${rows}`);
      return rb.map(([y0, y1]) => ({ x0, x1, y0, y1 }));
    });
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) boxes.push(grid[c][r]);
  } else {
    const rb = rowsOf(0, w - 1);
    if (rb.length !== rows) throw new Error(`${file}: found ${rb.length} rows of objects, expected ${rows}`);
    for (const [y0, y1] of rb) {
      const cb = colsOf(y0, y1);
      if (cb.length !== cols) throw new Error(`${file}: a row has ${cb.length} objects, expected ${cols}`);
      for (const [x0, x1] of cb) boxes.push({ x0, x1, y0, y1 });
    }
  }
  const out = [];
  for (const { x0, x1, y0, y1 } of boxes) {
    {
      let top = y1, bottom = y0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (fg[y * w + x]) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
      const cw = x1 - x0 + 1;
      const ch = bottom - top + 1;
      const rgba = Buffer.alloc(cw * ch * 4);
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++) {
          const s = at(x0 + x, top + y);
          const d = (y * cw + x) * 4;
          rgba[d] = data[s];
          rgba[d + 1] = data[s + 1];
          rgba[d + 2] = data[s + 2];
          rgba[d + 3] = fg[(top + y) * w + (x0 + x)] ? 255 : 0;
        }
      out.push({ rgba, cw, ch });
    }
  }
  return out;
}

const sheets = [
  { file: 'objects-a.png', first: 0 },
  { file: 'objects-b.png', first: 8 },
];
const have = sheets.filter((s) => existsSync(path.join(src, s.file)));
/** One picture shrunk into a frame: fit, bottom-aligned, written into a sheet of the given width at frame n. */
async function place(sheet, W, n, { rgba, cw, ch }) {
  const scale = Math.min(FIT / cw, FIT / ch);
  const tw = Math.max(1, Math.round(cw * scale));
  const th = Math.max(1, Math.round(ch * scale));
  const small = await sharp(rgba, { raw: { width: cw, height: ch, channels: 4 } }).resize(tw, th, { kernel: KERNEL }).raw().toBuffer();
  for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) sheet[(y * W + n * F + x) * 4 + 3] = 0;
  const ox = n * F + Math.round((F - tw) / 2);
  const oy = F - 1 - th;
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      const s = (y * tw + x) * 4;
      if (small[s + 3] < 128) continue;
      const d = ((oy + y) * W + ox + x) * 4;
      sheet[d] = small[s];
      sheet[d + 1] = small[s + 1];
      sheet[d + 2] = small[s + 2];
      sheet[d + 3] = 255;
    }
}

// furniture.png: desk, chair, plant, sofa, table and a tree, from art-source/flow/furniture.png (3 columns by 2 rows).
const furnitureSheet = path.join(src, 'furniture.png');
if (existsSync(furnitureSheet)) {
  const list = await cells(furnitureSheet, 3, 2, true);
  const W = F * list.length;
  const sheet = Buffer.alloc(W * F * 4);
  for (let i = 0; i < list.length; i++) await place(sheet, W, i, list[i]);
  await sharp(sheet, { raw: { width: W, height: F, channels: 4 } }).png().toFile(path.join(root, 'apps', 'web', 'public', 'office', 'furniture.png'));
  process.stdout.write(`wrote furniture.png (${list.length} pieces)\n`);
}

if (!have.length) {
  process.stdout.write('no objects-a.png or objects-b.png in art-source/flow: nothing to import\n');
  process.exit(0);
}
const base = await sharp(outPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const sheet = base.data;
const W = base.info.width;
for (const { file, first } of have) {
  const list = await cells(path.join(src, file), 4, 2);
  for (let i = 0; i < list.length; i++) {
    const { rgba, cw, ch } = list[i];
    const scale = Math.min(FIT / cw, FIT / ch);
    const tw = Math.max(1, Math.round(cw * scale));
    const th = Math.max(1, Math.round(ch * scale));
    const small = await sharp(rgba, { raw: { width: cw, height: ch, channels: 4 } }).resize(tw, th, { kernel: KERNEL }).raw().toBuffer();
    const n = first + i;
    for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) sheet[(y * W + n * F + x) * 4 + 3] = 0; // clear the drawn one
    const ox = n * F + Math.round((F - tw) / 2);
    const oy = F - 1 - th;
    for (let y = 0; y < th; y++)
      for (let x = 0; x < tw; x++) {
        const s = (y * tw + x) * 4;
        if (small[s + 3] < 128) continue;
        const d = ((oy + y) * W + ox + x) * 4;
        sheet[d] = small[s];
        sheet[d + 1] = small[s + 1];
        sheet[d + 2] = small[s + 2];
        sheet[d + 3] = 255;
      }
  }
  process.stdout.write(`objects ${first} to ${first + list.length - 1} from ${file}\n`);
}
await sharp(sheet, { raw: { width: W, height: base.info.height, channels: 4 } }).png().toFile(outPath);
process.stdout.write('wrote objects.png\n');
