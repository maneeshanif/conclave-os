// Turns the top-down furniture sheets made in Google Flow into one picture per item in apps/web/public/office/decor/.
// Run:  node scripts/import-flow-decor.mjs
//
// art-source/flow/decor-a.png and decor-b.png are each 4 columns by 2 rows of items seen from directly above, on a plain background.
// Every item is cut out (background and floor shadow removed) and shrunk to fit its footprint in tiles, keeping its shape, with
// nearest neighbour so the pixels stay crisp. The map's decor layer says where each item stands; chairs are turned by the scene.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { cells } from './lib/flow-slice.mjs';
import { DECOR_FOOT } from './lib/footprints.mjs';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'art-source', 'flow');
const out = path.join(root, 'apps', 'web', 'public', 'office', 'decor');
const T = 32;

/** Each sheet's items in reading order; the footprint of each is in scripts/lib/footprints.mjs. */
const SHEETS = [
  {
    file: 'decor-a.png',
    items: [
      'chair', 'desk', 'armchair', 'sofa', 'coffee', 'fridge', 'arcade', 'bookshelf',
    ],
  },
  {
    file: 'decor-b.png',
    items: [
      'cafe-table', 'pingpong', 'printer', 'bin', 'rug', 'plant', 'clock', 'tree',
    ],
  },
];

mkdirSync(out, { recursive: true });
let n = 0;
for (const sheet of SHEETS) {
  const file = path.join(src, sheet.file);
  if (!existsSync(file)) continue;
  const list = await cells(file, 4, 2);
  for (let i = 0; i < list.length; i++) {
    const name = sheet.items[i];
    const [tw, th] = DECOR_FOOT[name];
    const { rgba, cw, ch } = list[i];
    const scale = Math.min((tw * T) / cw, (th * T) / ch);
    const w = Math.max(1, Math.round(cw * scale));
    const h = Math.max(1, Math.round(ch * scale));
    const png = await sharp(rgba, { raw: { width: cw, height: ch, channels: 4 } }).resize(w, h, { kernel: 'nearest' }).png().toBuffer();
    writeFileSync(path.join(out, `${name}.png`), png);
    n++;
  }
}
process.stdout.write(`wrote ${n} decor pictures\n`);
