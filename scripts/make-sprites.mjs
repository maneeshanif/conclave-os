// Writes the office's people and furniture art into apps/web/public/office: people.png and furniture.png.
// Everything is drawn here from rectangles and a palette, so the art is ours and has no licence to track. Replace the PNGs with
// Kenney (CC0) or your own sheets of the same layout, and nothing else changes. Run: node scripts/make-sprites.mjs
//
// people.png: 32 by 32 frames. Rows are the directions down, left, right, up. Columns are six looks of three frames each
// (stand, step, step): look 0 is you, looks 1 to 5 are agents.
// furniture.png: one row of 32 by 32 pieces: desk, chair, plant, sofa, table.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import process from 'node:process';

const out = path.resolve(import.meta.dirname, '..', 'apps', 'web', 'public', 'office');
const F = 32;
const LOOKS = [
  { shirt: '#dc2626', hair: '#3b2a20', skin: '#e8b98f' }, // you
  { shirt: '#2563eb', hair: '#1f2937', skin: '#c68c5c' },
  { shirt: '#0f766e', hair: '#7c4a21', skin: '#f1c9a5' },
  { shirt: '#7c3aed', hair: '#111827', skin: '#8d5a3b' },
  { shirt: '#d97706', hair: '#b45309', skin: '#f4d2b0' },
  { shirt: '#be185d', hair: '#4b2e1e', skin: '#d9a679' },
];
const PANTS = '#334155';
const SHOE = '#111827';

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];

function canvas(w, h) {
  const px = Buffer.alloc(w * h * 4);
  return {
    w,
    h,
    px,
    rect(x, y, rw, rh, colour, alpha = 255) {
      const [r, g, b] = typeof colour === 'string' ? hex(colour) : colour;
      for (let j = y; j < y + rh; j++)
        for (let i = x; i < x + rw; i++) {
          if (i < 0 || j < 0 || i >= w || j >= h) continue;
          const o = (j * w + i) * 4;
          px[o] = r;
          px[o + 1] = g;
          px[o + 2] = b;
          px[o + 3] = alpha;
        }
    },
  };
}

/** One person, in one direction, in one of three frames, drawn at the frame's origin (ox, oy). */
function person(c, ox, oy, look, dir, frame) {
  const bob = frame === 0 ? 0 : 1; // a little bounce while walking
  const x = ox + 10;
  const y = oy + 4 + bob;
  // Shadow.
  c.rect(ox + 9, oy + 27, 14, 3, '#000000', 60);
  // Legs. Frame 1 puts the left leg forward, frame 2 the right.
  const lift = (leg) => (frame === 0 ? 0 : (frame === 1) === (leg === 0) ? -1 : 0);
  if (dir === 'down' || dir === 'up') {
    c.rect(x + 2, y + 17 + lift(0), 3, 6 - lift(0), PANTS);
    c.rect(x + 7, y + 17 + lift(1), 3, 6 - lift(1), PANTS);
    c.rect(x + 2, y + 23, 3, 2, SHOE);
    c.rect(x + 7, y + 23, 3, 2, SHOE);
  } else {
    const swing = frame === 0 ? 0 : frame === 1 ? 2 : -2;
    c.rect(x + 3 + swing, y + 17, 3, 6, PANTS);
    c.rect(x + 6 - swing, y + 17, 3, 6, PANTS);
    c.rect(x + 3 + swing, y + 23, 3, 2, SHOE);
    c.rect(x + 6 - swing, y + 23, 3, 2, SHOE);
  }
  // Body and arms.
  c.rect(x + 1, y + 9, 10, 9, look.shirt);
  c.rect(x - 1, y + 10, 2, 7, look.shirt);
  c.rect(x + 11, y + 10, 2, 7, look.shirt);
  c.rect(x - 1, y + 16, 2, 2, look.skin);
  c.rect(x + 11, y + 16, 2, 2, look.skin);
  // Head.
  c.rect(x + 1, y, 10, 9, look.skin);
  if (dir === 'up') {
    c.rect(x + 1, y, 10, 9, look.hair);
  } else {
    c.rect(x + 1, y, 10, 3, look.hair);
    if (dir === 'down') {
      c.rect(x + 3, y + 4, 2, 2, '#111827');
      c.rect(x + 7, y + 4, 2, 2, '#111827');
    } else if (dir === 'left') {
      c.rect(x + 1, y, 3, 8, look.hair);
      c.rect(x + 3, y + 4, 2, 2, '#111827');
    } else {
      c.rect(x + 8, y, 3, 8, look.hair);
      c.rect(x + 7, y + 4, 2, 2, '#111827');
    }
  }
}

function people() {
  const dirs = ['down', 'left', 'right', 'up'];
  const c = canvas(F * 3 * LOOKS.length, F * dirs.length);
  LOOKS.forEach((look, l) => dirs.forEach((dir, r) => [0, 1, 2].forEach((f) => person(c, (l * 3 + f) * F, r * F, look, dir, f))));
  return c;
}

function furniture() {
  const c = canvas(F * 5, F);
  // 0 desk: a wooden top with a screen and a keyboard.
  c.rect(0, 8, 32, 18, '#8a6b4a');
  c.rect(0, 8, 32, 3, '#a8845c');
  c.rect(10, 1, 12, 9, '#1f2937');
  c.rect(11, 2, 10, 6, '#38bdf8');
  c.rect(14, 10, 4, 2, '#1f2937');
  c.rect(8, 16, 16, 4, '#e5e7eb');
  c.rect(1, 26, 3, 5, '#6b4f33');
  c.rect(28, 26, 3, 5, '#6b4f33');
  // 1 chair: a seat and a back.
  c.rect(32 + 8, 6, 16, 6, '#475569');
  c.rect(32 + 8, 12, 16, 12, '#64748b');
  c.rect(32 + 14, 24, 4, 6, '#334155');
  // 2 plant: a pot and leaves.
  c.rect(64 + 10, 20, 12, 10, '#b45309');
  c.rect(64 + 9, 18, 14, 3, '#92400e');
  c.rect(64 + 6, 6, 8, 12, '#16a34a');
  c.rect(64 + 18, 4, 8, 14, '#15803d');
  c.rect(64 + 12, 1, 8, 16, '#22c55e');
  // 3 sofa: a long soft seat.
  c.rect(96 + 1, 8, 30, 8, '#15803d');
  c.rect(96 + 0, 14, 32, 12, '#16a34a');
  c.rect(96 + 0, 12, 4, 14, '#166534');
  c.rect(96 + 28, 12, 4, 14, '#166534');
  // 4 table: a round top on a leg.
  c.rect(128 + 4, 10, 24, 10, '#d6b88a');
  c.rect(128 + 6, 8, 20, 3, '#e7cfa6');
  c.rect(128 + 14, 20, 4, 9, '#8a6b4a');
  return c;
}

// objects.png: one 32 by 32 picture for each object type, in the order of OBJECT_TYPES (packages/shared/src/office/objects.ts).
// Pixel art drawn from rectangles here, so it is ours. Boards are notes on a frame, desks have things on them, and so on.
const board = (c, ox, frame, notes) => {
  c.rect(ox + 3, 3, 26, 21, '#6b4f33'); // frame
  c.rect(ox + 4, 4, 24, 19, frame);
  notes.forEach(([x, y, col], i) => c.rect(ox + 6 + x, 6 + y, 6, 5, col, 255 - (i % 2) * 20));
  c.rect(ox + 9, 24, 14, 2, '#00000040'.slice(0, 7), 70); // its shadow on the floor
  c.rect(ox + 8, 24, 3, 6, '#4b3a27');
  c.rect(ox + 21, 24, 3, 6, '#4b3a27');
};
const deskWith = (c, ox, top, item) => {
  c.rect(ox + 1, 12, 30, 13, top);
  c.rect(ox + 1, 12, 30, 3, '#ffffff', 45);
  c.rect(ox + 2, 25, 3, 5, '#4b3a27');
  c.rect(ox + 27, 25, 3, 5, '#4b3a27');
  item(c, ox);
};
const monitor = (c, ox, x, screen) => {
  c.rect(ox + x, 2, 14, 10, '#111827');
  c.rect(ox + x + 1, 3, 12, 7, screen);
  c.rect(ox + x + 5, 12, 4, 2, '#111827');
};
function objects() {
  const c = canvas(F * 16, F);
  const O = (i) => i * F;
  // 0 approvals-desk: a desk with an in-tray and a stamp.
  deskWith(c, O(0), '#8a6b4a', (c, ox) => {
    c.rect(ox + 5, 6, 12, 7, '#e5e7eb');
    c.rect(ox + 5, 6, 12, 2, '#f59e0b');
    c.rect(ox + 20, 8, 6, 5, '#dc2626');
    c.rect(ox + 22, 5, 2, 4, '#7f1d1d');
  });
  // 1 whiteboard: goals ladder, three steps.
  board(c, O(1), '#f8fafc', [[0, 12, '#86efac'], [7, 6, '#fde047'], [14, 0, '#93c5fd']]);
  // 2 screen: a wall monitor with a green line chart.
  c.rect(O(2) + 2, 4, 28, 18, '#111827');
  c.rect(O(2) + 4, 6, 24, 14, '#0f172a');
  for (const [x, y] of [[6, 16], [10, 13], [14, 15], [18, 10], [22, 11], [25, 8]]) c.rect(O(2) + x, y, 3, 3, '#4ade80');
  c.rect(O(2) + 12, 22, 8, 3, '#374151');
  c.rect(O(2) + 8, 25, 16, 3, '#1f2937');
  // 3 mailbox: a post box with a flag.
  c.rect(O(3) + 7, 6, 18, 14, '#2563eb');
  c.rect(O(3) + 7, 6, 18, 3, '#60a5fa');
  c.rect(O(3) + 10, 12, 12, 2, '#1e3a8a');
  c.rect(O(3) + 24, 4, 2, 9, '#dc2626');
  c.rect(O(3) + 14, 20, 4, 10, '#6b7280');
  c.rect(O(3) + 10, 29, 12, 2, '#4b5563');
  // 4 jobboard: a board of cards, greyed because the room is not built yet.
  board(c, O(4), '#d6c8a6', [[0, 0, '#fca5a5'], [8, 3, '#a5b4fc'], [0, 8, '#fcd34d'], [9, 10, '#86efac']]);
  // 5 boardroom-table: a long dark table with chairs.
  c.rect(O(5) + 2, 10, 28, 12, '#5b3f2a');
  c.rect(O(5) + 2, 10, 28, 3, '#7a5738');
  for (const x of [4, 12, 20, 26]) c.rect(O(5) + x, 5, 5, 5, '#334155');
  for (const x of [4, 12, 20, 26]) c.rect(O(5) + x, 23, 5, 5, '#334155');
  c.rect(O(5) + 13, 14, 6, 4, '#e5e7eb');
  // 6 task-board: three columns of cards.
  board(c, O(6), '#e2e8f0', [[0, 0, '#fde047'], [0, 7, '#fde047'], [9, 3, '#93c5fd'], [17, 0, '#86efac'], [17, 8, '#86efac']]);
  // 7 needs-you-board: red notes, urgent.
  board(c, O(7), '#fee2e2', [[0, 0, '#ef4444'], [9, 4, '#f97316'], [3, 9, '#ef4444'], [15, 8, '#f59e0b']]);
  // 8 brief-desk: a desk with a coffee and a paper.
  deskWith(c, O(8), '#a8845c', (c, ox) => {
    c.rect(ox + 5, 7, 11, 6, '#f8fafc');
    c.rect(ox + 7, 9, 7, 1, '#94a3b8');
    c.rect(ox + 21, 8, 5, 5, '#f8fafc');
    c.rect(ox + 22, 6, 3, 2, '#92400e');
  });
  // 9 pipeline-board: a funnel of stages.
  board(c, O(9), '#ecfeff', [[0, 0, '#67e8f9'], [3, 6, '#22d3ee'], [6, 12, '#06b6d4']]);
  // 10 campaign-board: a megaphone-orange board.
  board(c, O(10), '#fff7ed', [[0, 0, '#fb923c'], [9, 0, '#fdba74'], [0, 8, '#fdba74'], [9, 8, '#fb923c']]);
  // 11 signal-radio: a radio with an aerial.
  c.rect(O(11) + 6, 12, 20, 13, '#475569');
  c.rect(O(11) + 6, 12, 20, 3, '#64748b');
  c.rect(O(11) + 9, 17, 8, 6, '#0f172a');
  c.rect(O(11) + 20, 17, 3, 3, '#fbbf24');
  c.rect(O(11) + 22, 3, 2, 10, '#94a3b8');
  c.rect(O(11) + 21, 2, 4, 2, '#ef4444');
  // 12 idea-wall: a wall of coloured notes.
  board(c, O(12), '#fef9c3', [[0, 0, '#f472b6'], [8, 2, '#a78bfa'], [16, 0, '#34d399'], [2, 9, '#60a5fa'], [11, 10, '#fbbf24']]);
  // 13 terminal: a computer with a green prompt.
  deskWith(c, O(13), '#475569', (c, ox) => {
    monitor(c, ox, 9, '#052e16');
    c.rect(ox + 12, 5, 4, 1, '#4ade80');
    c.rect(ox + 12, 7, 7, 1, '#4ade80');
    c.rect(ox + 8, 15, 16, 3, '#cbd5e1');
  });
  // 14 dept-board: the department's own task board, with a coloured top rail.
  board(c, O(14), '#f1f5f9', [[0, 3, '#a5b4fc'], [9, 0, '#fde047'], [9, 8, '#86efac'], [17, 4, '#f9a8d4']]);
  c.rect(O(14) + 4, 4, 24, 3, '#6366f1');
  // 15 dept-table: a round meeting table with four stools.
  c.rect(O(15) + 7, 9, 18, 14, '#d6b88a');
  c.rect(O(15) + 9, 7, 14, 3, '#e7cfa6');
  c.rect(O(15) + 3, 13, 4, 6, '#64748b');
  c.rect(O(15) + 25, 13, 4, 6, '#64748b');
  c.rect(O(15) + 12, 23, 8, 4, '#64748b');
  return c;
}

function png(c) {
  const raw = Buffer.alloc((c.w * 4 + 1) * c.h);
  for (let y = 0; y < c.h; y++) {
    raw[y * (c.w * 4 + 1)] = 0;
    c.px.copy(raw, y * (c.w * 4 + 1) + 1, y * c.w * 4, (y + 1) * c.w * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0);
  ihdr.writeUInt32BE(c.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'people.png'), png(people()));
writeFileSync(path.join(out, 'furniture.png'), png(furniture()));
writeFileSync(path.join(out, 'objects.png'), png(objects()));
process.stdout.write('wrote people.png, furniture.png and objects.png\n');
