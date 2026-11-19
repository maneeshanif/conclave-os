// Turns the furniture sheets made in Google Flow into apps/web/public/office/objects.png, one 32 by 32 picture for each object type
// in the order of OBJECT_TYPES. Run after `node scripts/make-sprites.mjs`:  node scripts/import-flow-objects.mjs
//
// art-source/flow/objects-a.png holds objects 0 to 7 and objects-b.png holds 8 to 15, each as 4 columns by 2 rows on a plain
// background. The background colour is taken from the corners; the pale floor shadows under each object are removed too, so only the
// object stays. Each object is shrunk to fit a 30 by 30 box (nearest neighbour, so the pixels stay crisp) and stands on the bottom
// edge of its frame. A missing sheet leaves those objects as drawn by make-sprites.mjs.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'art-source', 'flow');
const outPath = path.join(root, 'apps', 'web', 'public', 'office', 'objects.png');
const F = 32;
const FIT = 30;
const decorDir = path.join(root, 'apps', 'web', 'public', 'office', 'decor');
const KERNEL = process.env.FLOW_KERNEL ?? 'nearest';

import { cells } from './lib/flow-slice.mjs';
import { OBJECT_FOOT, OBJECT_TURN } from './lib/footprints.mjs';


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
    // The picture at its own size, fitted to the tiles it covers (scripts/lib/footprints.mjs), for the world to draw.
    const type = Object.keys(OBJECT_FOOT)[first + i];
    const [fw, fh] = OBJECT_FOOT[type];
    const turn = OBJECT_TURN[type] ?? 0;
    const [sw, sh] = turn % 180 === 0 ? [cw, ch] : [ch, cw];
    const k = Math.min((fw * F) / sw, (fh * F) / sh);
    mkdirSync(decorDir, { recursive: true });
    writeFileSync(path.join(decorDir, 'obj-' + type + '.png'), await sharp(rgba, { raw: { width: cw, height: ch, channels: 4 } }).rotate(turn).resize(Math.max(1, Math.round(sw * k)), Math.max(1, Math.round(sh * k)), { kernel: KERNEL }).png().toBuffer());
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
