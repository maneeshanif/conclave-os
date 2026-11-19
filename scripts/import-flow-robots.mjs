// Turns the robot sheets made in Google Flow into apps/web/public/office/agents.png: the agents, drawn as hovering robots.
// Run:  node scripts/import-flow-robots.mjs
//
// art-source/flow/robot-<n>.png (n = 0 to 4) is one robot, 3 columns by 4 rows: facing the camera, left, left again, away; each row
// has three frames (idle and two bobs). The sheet agents.png has the same layout as people.png (rows down, left, right, up; each look
// three frames across) with five looks. The right-facing row is the left-facing one mirrored. A look with no sheet of its own is the first helper with the colour of its jumpsuit turned, so every agent can look different.
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { cells } from './lib/flow-slice.mjs';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'art-source', 'flow');
const out = path.join(root, 'apps', 'web', 'public', 'office', 'agents.png');
const F = 32;
const LOOKS = 5;
const MAX_W = 26;
const MAX_H = 26;
/** Hue turns, in degrees, for the looks that have no sheet of their own. */
const HUE = [0, 55, 120, 225, 170];

/** Turns the colour of the jumpsuit (the teal part) and leaves skin, outline and grey alone, so every helper keeps a natural face. */
function recolour(rgba, turn) {
  const out = Buffer.from(rgba);
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i] / 255, g = out[i + 1] / 255, b = out[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const l = (max + min) / 2;
    const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d !== 0) h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
    if (sat < 0.12 || h < 110 || h > 210) continue; // not jumpsuit
    const nh = (h + turn) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * sat, x = c * (1 - Math.abs(((nh / 60) % 2) - 1)), m = l - c / 2;
    const [rr, gg, bb] = nh < 60 ? [c, x, 0] : nh < 120 ? [x, c, 0] : nh < 180 ? [0, c, x] : nh < 240 ? [0, x, c] : nh < 300 ? [x, 0, c] : [c, 0, x];
    out[i] = Math.round((rr + m) * 255);
    out[i + 1] = Math.round((gg + m) * 255);
    out[i + 2] = Math.round((bb + m) * 255);
  }
  return out;
}

const files = Array.from({ length: LOOKS }, (_, n) => path.join(src, `robot-${n}.png`)).filter((f) => existsSync(f));
if (!files.length) {
  process.stdout.write('no robot-<n>.png in art-source/flow: nothing to import\n');
  process.exit(0);
}
const W = F * 3 * LOOKS;
const sheet = Buffer.alloc(W * F * 4 * 4);
for (let look = 0; look < LOOKS; look++) {
  const own = existsSync(path.join(src, `robot-${look}.png`));
  const file = own ? path.join(src, `robot-${look}.png`) : files[0];
  const cut = await cells(file, 3, 4); // row-major: 12 cut-outs
  const turn = own ? 0 : HUE[look];
  const list = turn ? cut.map((c) => ({ ...c, rgba: recolour(c.rgba, turn) })) : cut;
  const maxW = Math.max(...list.map((c) => c.cw));
  const maxH = Math.max(...list.map((c) => c.ch));
  const scale = Math.min(MAX_W / maxW, MAX_H / maxH); // one scale for all, so the bob does not change the size
  const plan = [[0, false, 0], [1, false, 1], [1, true, 2], [3, false, 3]]; // [source row, mirror, our row]
  for (const [srcRow, flip, row] of plan) {
    for (let col = 0; col < 3; col++) {
      const { rgba, cw, ch } = list[srcRow * 3 + col];
      const tw = Math.max(1, Math.round(cw * scale));
      const th = Math.max(1, Math.round(ch * scale));
      const small = await sharp(rgba, { raw: { width: cw, height: ch, channels: 4 } }).resize(tw, th, { kernel: 'nearest' }).raw().toBuffer();
      const ox = (look * 3 + col) * F + Math.round((F - tw) / 2);
      const oy = row * F + (F - 4 - th); // hovering a little above the floor
      for (let y = 0; y < th; y++)
        for (let x = 0; x < tw; x++) {
          const s = (y * tw + (flip ? tw - 1 - x : x)) * 4;
          if (small[s + 3] < 128) continue;
          const d = ((oy + y) * W + ox + x) * 4;
          sheet[d] = small[s];
          sheet[d + 1] = small[s + 1];
          sheet[d + 2] = small[s + 2];
          sheet[d + 3] = 255;
        }
      // A soft shadow on the floor under it.
      for (let y = row * F + F - 3; y < row * F + F - 1; y++)
        for (let x = (look * 3 + col) * F + 9; x < (look * 3 + col) * F + 23; x++) {
          const d = (y * W + x) * 4;
          if (sheet[d + 3] === 0) sheet[d + 3] = 60;
        }
    }
  }
}
await sharp(sheet, { raw: { width: W, height: F * 4, channels: 4 } }).png().toFile(out);
process.stdout.write(`wrote agents.png from ${files.length} robot sheet(s)\n`);
