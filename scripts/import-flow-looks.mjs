// Turns character sheets made in Google Flow into looks in apps/web/public/office/people.png.
// Run after `node scripts/make-sprites.mjs`:  node scripts/import-flow-looks.mjs
//
// Each sheet is art-source/flow/look-<n>.png (n = 0 to 5, the look it becomes): a 3 column by 4 row grid of one character on a plain
// background. Columns are stand, step, step. Rows are facing the camera, left, left again (or right), and away. The script finds the
// background colour from the corners, removes it, finds the twelve figures, shrinks them with one shared scale (nearest neighbour,
// so the pixels stay crisp), stands them on one baseline inside a 32 by 32 frame, makes the right-facing row by mirroring the left,
// and writes them over that look in people.png. A look with no sheet keeps the one drawn by make-sprites.mjs.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'art-source', 'flow');
const peoplePath = path.join(root, 'apps', 'web', 'public', 'office', 'people.png');
const F = 32;
const LOOKS = 6;
const PER_ROW = LOOKS * 3;
const MAX_W = 22;
const MAX_H = 28;

/** Bands of pixels that are not background along one axis: [start, end] pairs, ignoring specks. */
function bands(counts, minRun) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= counts.length; i++) {
    const on = i < counts.length && counts[i] > 0;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if (i - start >= minRun) out.push([start, i - 1]);
      start = -1;
    }
  }
  return out;
}

async function frames(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const px = (x, y) => [data[(y * w + x) * 4], data[(y * w + x) * 4 + 1], data[(y * w + x) * 4 + 2]];
  const corners = [px(2, 2), px(w - 3, 2), px(2, h - 3), px(w - 3, h - 3)];
  const bg = [0, 1, 2].map((i) => Math.round(corners.reduce((s, c) => s + c[i], 0) / 4));
  // Far from the background colour is figure. The background is a soft grey, so the margin is generous; the figures have black outlines.
  const fg = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = px(x, y);
      const d = Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]);
      if (d > 70) fg[y * w + x] = 1;
    }
  const rowCounts = Array.from({ length: h }, (_, y) => {
    let n = 0;
    for (let x = 0; x < w; x++) n += fg[y * w + x];
    return n;
  });
  const rowBands = bands(rowCounts, 20);
  if (rowBands.length !== 4) throw new Error(`${file}: found ${rowBands.length} rows of figures, expected 4`);
  const cells = [];
  for (const [y0, y1] of rowBands) {
    const colCounts = Array.from({ length: w }, (_, x) => {
      let n = 0;
      for (let y = y0; y <= y1; y++) n += fg[y * w + x];
      return n;
    });
    const colBands = bands(colCounts, 12);
    if (colBands.length < 3) throw new Error(`${file}: a row has ${colBands.length} figures, expected at least 3`);
    // Three figures: stand, step, step. A longer walk cycle gives the standing frame and two steps from it (the 2nd and 4th).
    const pick = colBands.length === 3 ? colBands : [colBands[0], colBands[1], colBands[Math.min(3, colBands.length - 1)]];
    cells.push(
      pick.map(([x0, x1]) => {
        // Tighten to the figure's own box inside this cell.
        let top = y1, bottom = y0;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (fg[y * w + x]) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
        return { x0, x1, y0: top, y1: bottom };
      }),
    );
  }
  return { data, w, h, fg, cells };
}

/** One look: returns a 96 by 128 RGBA buffer (3 frames across, 4 directions down: down, left, right, up). */
async function look(file) {
  const { data, w, fg, cells } = await frames(file);
  const all = cells.flat();
  const maxW = Math.max(...all.map((c) => c.x1 - c.x0 + 1));
  const maxH = Math.max(...all.map((c) => c.y1 - c.y0 + 1));
  const scale = Math.min(MAX_W / maxW, MAX_H / maxH); // one scale for every frame, so the walk does not pulse
  const out = Buffer.alloc(F * 3 * F * 4 * 4);
  const put = (row, col, buf, bw, bh, flip) => {
    const ox = col * F + Math.round((F - bw) / 2);
    const oy = row * F + (F - 4 - bh); // feet on one baseline, a little room under for the shadow
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const sx = flip ? bw - 1 - x : x;
        const o = (y * bw + sx) * 4;
        if (buf[o + 3] < 128) continue;
        const d = ((oy + y) * F * 3 + (ox + x)) * 4;
        out[d] = buf[o];
        out[d + 1] = buf[o + 1];
        out[d + 2] = buf[o + 2];
        out[d + 3] = 255;
      }
  };
  const cut = async (c) => {
    const cw = c.x1 - c.x0 + 1;
    const ch = c.y1 - c.y0 + 1;
    const rgba = Buffer.alloc(cw * ch * 4);
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        const s = ((c.y0 + y) * w + (c.x0 + x)) * 4;
        const d = (y * cw + x) * 4;
        rgba[d] = data[s];
        rgba[d + 1] = data[s + 1];
        rgba[d + 2] = data[s + 2];
        rgba[d + 3] = fg[(c.y0 + y) * w + (c.x0 + x)] ? 255 : 0;
      }
    const tw = Math.max(1, Math.round(cw * scale));
    const th = Math.max(1, Math.round(ch * scale));
    const small = await sharp(rgba, { raw: { width: cw, height: ch, channels: 4 } }).resize(tw, th, { kernel: 'nearest' }).raw().toBuffer();
    return { buf: small, tw, th };
  };
  // Source rows: 0 toward you, 1 left, 2 left again (mirrored into the right-facing row), 3 away. Ours: down, left, right, up.
  const plan = [[0, false, 0], [1, false, 1], [1, true, 2], [3, false, 3]];
  for (const [srcRow, flip, row] of plan)
    for (let col = 0; col < 3; col++) {
      const { buf, tw, th } = await cut(cells[srcRow][col]);
      put(row, col, buf, tw, th, flip);
    }
  // A soft shadow under the feet, as in the drawn looks.
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 3; col++)
      for (let y = row * F + F - 4; y < row * F + F - 1; y++)
        for (let x = col * F + 9; x < col * F + 23; x++) {
          const d = (y * F * 3 + x) * 4;
          if (out[d + 3] === 0) {
            out[d + 3] = 60;
          }
        }
  return out;
}

if (!existsSync(src)) {
  process.stdout.write('no art-source/flow folder: nothing to import\n');
  process.exit(0);
}
const sheets = readdirSync(src).flatMap((f) => {
  const m = /^look-(\d)\.png$/.exec(f);
  return m && Number(m[1]) < LOOKS ? [{ n: Number(m[1]), file: path.join(src, f) }] : [];
});
if (!sheets.length) {
  process.stdout.write('no look-<n>.png sheets in art-source/flow: nothing to import\n');
  process.exit(0);
}
const base = await sharp(peoplePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const sheet = base.data;
const W = base.info.width;
for (const { n, file } of sheets) {
  const block = await look(file);
  // people.png: rows down, left, right, up; each row has six looks of three frames, so look n starts at column n * 3.
  for (let row = 0; row < 4; row++)
    for (let y = 0; y < F; y++)
      for (let x = 0; x < F * 3; x++) {
        const s = ((row * F + y) * F * 3 + x) * 4;
        const d = ((row * F + y) * W + n * 3 * F + x) * 4;
        sheet[d] = block[s];
        sheet[d + 1] = block[s + 1];
        sheet[d + 2] = block[s + 2];
        sheet[d + 3] = block[s + 3];
      }
  process.stdout.write(`look ${n} from ${path.basename(file)}\n`);
}
if (PER_ROW * F !== W) throw new Error('people.png is not the layout this script expects');
await sharp(sheet, { raw: { width: W, height: base.info.height, channels: 4 } }).png().toFile(peoplePath);
process.stdout.write('wrote people.png\n');
