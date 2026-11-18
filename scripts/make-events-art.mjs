// Draws the pieces for conferences, job fairs and sports, in code, into apps/web/public/office/decor/. Run: node scripts/make-events-art.mjs
// A stage, a lectern, a projector screen, job-fair booths and banners, a registration desk, theatre seats, a banquet table, a basketball
// court and a running track. Drawn here from rectangles, so the art is ours and has no licence to track. (If Flow is available these can
// be replaced with generated pictures of the same size; nothing else changes.)
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { canvas } from './lib/pixel.mjs';
import { EVENT_FOOT, OBJECT_FOOT } from './lib/footprints.mjs';

const out = path.resolve(import.meta.dirname, '..', 'apps', 'web', 'public', 'office', 'decor');
mkdirSync(out, { recursive: true });
const T = 32;
const INK = '#1b2340';
const pic = (name) => {
  const [w, h] = EVENT_FOOT[name];
  return canvas(w * T, h * T);
};
const save = (name, c) => writeFileSync(path.join(out, `${name}.png`), c.png());

// A lectern: a wooden stand seen from above, with a microphone on a stalk.
{
  const c = pic('lectern');
  c.rect(7, 8, 18, 16, '#8a6b4a');
  c.rect(7, 8, 18, 3, '#a8845c');
  c.frame(7, 8, 18, 16, INK);
  c.rect(15, 3, 2, 8, '#374151');
  c.disc(16, 3, 2, '#111827');
  c.rect(10, 14, 12, 6, '#6b4f33');
  save('lectern', c);
}
// A projector screen: a white screen in a dark frame, with a slide on it.
{
  const c = pic('screen-wide');
  c.rect(2, 4, 92, 22, '#1f2937');
  c.rect(4, 6, 88, 18, '#f8fafc');
  c.rect(10, 9, 30, 3, '#2563eb');
  c.rect(10, 15, 44, 2, '#94a3b8');
  c.rect(10, 19, 36, 2, '#94a3b8');
  c.rect(62, 9, 24, 12, '#bfdbfe');
  c.rect(66, 13, 16, 4, '#60a5fa');
  c.frame(2, 4, 92, 22, INK);
  save('screen-wide', c);
}
// Job-fair booths: a table under a coloured backdrop, with a laptop and a pile of leaflets.
for (const [name, backdrop, trim] of [['booth', '#2563eb', '#93c5fd'], ['booth2', '#ea580c', '#fdba74'], ['booth3', '#16a34a', '#86efac']]) {
  const c = pic(name);
  c.rect(2, 2, 60, 10, backdrop);
  c.rect(2, 2, 60, 2, trim);
  c.rect(8, 6, 20, 3, '#ffffff');
  c.rect(34, 6, 12, 3, trim);
  c.frame(2, 2, 60, 10, INK);
  c.rect(4, 14, 56, 14, '#d6b88a');
  c.rect(4, 14, 56, 2, '#e7cfa6');
  c.frame(4, 14, 56, 14, INK);
  c.rect(10, 18, 14, 8, '#374151'); // a laptop
  c.rect(11, 19, 12, 5, '#38bdf8');
  c.rect(34, 18, 6, 6, '#ffffff'); // leaflets
  c.rect(42, 19, 6, 6, '#fde047');
  c.rect(50, 18, 6, 6, '#ffffff');
  save(name, c);
}
// A registration desk with a row of name badges and a sign.
{
  const c = pic('regdesk');
  c.rect(2, 8, 60, 18, '#8a6b4a');
  c.rect(2, 8, 60, 3, '#a8845c');
  c.frame(2, 8, 60, 18, INK);
  for (let i = 0; i < 8; i++) {
    c.rect(6 + i * 7, 14, 5, 7, '#ffffff');
    c.rect(6 + i * 7, 14, 5, 2, ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b'][i % 4]);
  }
  c.rect(22, 2, 20, 5, '#1f2a5c');
  c.rect(24, 4, 16, 1, '#fff6e5');
  save('regdesk', c);
}
// A roll-up banner: a tall stand with a coloured panel.
for (const [name, colour] of [['banner', '#7c3aed'], ['banner2', '#0891b2']]) {
  const c = pic(name);
  c.rect(6, 4, 20, 54, colour);
  c.rect(6, 4, 20, 4, '#ffffff');
  c.rect(10, 14, 12, 12, '#ffffff');
  c.rect(12, 16, 8, 8, colour);
  c.rect(9, 34, 14, 2, '#ffffff');
  c.rect(9, 40, 10, 2, '#e5e7eb');
  c.frame(6, 4, 20, 54, INK);
  c.rect(8, 58, 16, 3, '#374151');
  save(name, c);
}
// A theatre seat from above: a red cushion and back.
{
  const c = pic('seat');
  c.rect(6, 5, 20, 7, '#7f1d1d');
  c.rect(6, 12, 20, 15, '#b91c1c');
  c.rect(8, 14, 16, 11, '#dc2626');
  c.frame(6, 5, 20, 22, INK);
  c.rect(4, 12, 3, 12, '#7f1d1d');
  c.rect(25, 12, 3, 12, '#7f1d1d');
  save('seat', c);
}
// A banquet table: a round white cloth with eight chairs round it.
{
  const c = pic('banquet');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    c.disc(Math.round(32 + Math.cos(a) * 26), Math.round(32 + Math.sin(a) * 26), 5, '#6b4f33');
  }
  c.disc(32, 32, 18, '#f8fafc');
  c.ring(32, 32, 18, INK);
  c.disc(32, 32, 5, '#fde047');
  c.disc(26, 28, 2, '#94a3b8');
  c.disc(38, 36, 2, '#94a3b8');
  save('banquet', c);
}
// A welcome sign board on a stand.
{
  const c = pic('signboard');
  c.rect(2, 3, 60, 22, '#1f2a5c');
  c.frame(2, 3, 60, 22, INK);
  c.rect(8, 9, 48, 3, '#fff6e5');
  c.rect(14, 16, 36, 2, '#93c5fd');
  c.rect(10, 25, 3, 5, '#4b3a27');
  c.rect(51, 25, 3, 5, '#4b3a27');
  save('signboard', c);
}
// A stage: a raised wooden platform with a curtain at the back and lights along the front.
{
  const c = pic('stage');
  c.rect(0, 0, 256, 96, '#5b3f2a');
  for (let y = 0; y < 96; y += 8) c.rect(0, y, 256, 1, '#4b3a27');
  c.rect(0, 0, 256, 20, '#7f1d1d'); // the curtain
  for (let x = 0; x < 256; x += 16) c.rect(x, 0, 2, 20, '#991b1b');
  c.rect(0, 84, 256, 12, '#3b2a1c'); // the front edge
  for (let x = 8; x < 256; x += 24) c.disc(x, 90, 2, '#fde047');
  c.frame(0, 0, 256, 96, INK);
  save('stage', c);
}
// A basketball court: wood floor, white lines, a centre circle, a key and a hoop at each end.
{
  const c = pic('court');
  const W = 256;
  const H = 160;
  c.rect(0, 0, W, H, '#d19a5b');
  for (let y = 0; y < H; y += 10) c.rect(0, y, W, 1, '#c28a4c');
  const line = '#ffffff';
  c.frame(4, 4, W - 8, H - 8, line);
  c.rect(W / 2 - 1, 4, 2, H - 8, line);
  c.ring(W / 2, H / 2, 22, line);
  for (const side of [0, 1]) {
    const x = side === 0 ? 4 : W - 4 - 50;
    c.frame(x, H / 2 - 26, 50, 52, line);
    c.ring(side === 0 ? 4 + 50 : W - 4 - 50, H / 2, 16, line);
    c.rect(side === 0 ? 8 : W - 12, H / 2 - 10, 4, 20, '#e5e7eb');
    c.disc(side === 0 ? 16 : W - 16, H / 2, 4, '#f97316');
  }
  c.frame(0, 0, W, H, INK);
  save('court', c);
}
// A running track: a green field inside a brown oval, with lane lines.
{
  const c = pic('track');
  const W = 384;
  const H = 192;
  const inside = (x, y, rx, ry) => ((x - W / 2) / rx) ** 2 + ((y - H / 2) / ry) ** 2 <= 1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (inside(x, y, W / 2 - 2, H / 2 - 2)) c.rect(x, y, 1, 1, '#b45309');
      if (inside(x, y, W / 2 - 40, H / 2 - 40)) c.rect(x, y, 1, 1, '#4d7c0f');
    }
  for (const d of [13, 26]) {
    for (let a = 0; a < 1440; a++) {
      const t = (a / 1440) * Math.PI * 2;
      c.rect(Math.round(W / 2 + Math.cos(t) * (W / 2 - 2 - d)), Math.round(H / 2 + Math.sin(t) * (H / 2 - 2 - d)), 1, 1, '#fef3c7');
    }
  }
  c.rect(W / 2 - 1, H - 42, 2, 40, '#ffffff'); // the finish line
  c.disc(W / 2, H / 2, 6, '#ffffff');
  save('track', c);
}
process.stdout.write(`wrote ${Object.keys(EVENT_FOOT).length} event pictures\n`);

// The deploy board (S7-9): a dark board with a row of status lights, green for live and red for failed. An office object, so it is named obj-<type>.
{
  const [w, h] = OBJECT_FOOT['deploy-board'];
  const c = canvas(w * T, h * T);
  c.rect(2, 3, w * T - 4, h * T - 8, '#1f2937');
  c.frame(2, 3, w * T - 4, h * T - 8, INK);
  c.rect(6, 7, w * T - 12, 4, '#6366f1');
  const lights = ['#22c55e', '#22c55e', '#ef4444', '#22c55e', '#fbbf24'];
  lights.forEach((col, i) => {
    c.disc(12 + i * 11, 20, 3, col);
    c.rect(8 + i * 11, 26, 8, 1, '#475569');
  });
  save('obj-deploy-board', c);
}
