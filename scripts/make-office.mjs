// Writes the starter office: company/office.tmj (a Tiled JSON map) and apps/web/public/office/tiles.png (the tiles it uses).
// The tiles are drawn here, flat colours, so the art is ours and has no license to track. Replace the PNG with Kenney tiles (CC0)
// or your own, or edit the map in Tiled; the OS reads the map file, not this script. Run: node scripts/make-office.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const T = 32;
const W = 40;
const H = 24;

// ---- The tiles: eight 32 by 32 squares in one row ----
const FLOOR = 1, WALL = 2, CARPET = 3, WOOD = 4, LOUNGE = 5, DOOR = 6, DESK = 7, THING = 8;
const colours = { [FLOOR]: [232, 228, 218], [WALL]: [59, 63, 74], [CARPET]: [201, 214, 232], [WOOD]: [216, 185, 138], [LOUNGE]: [207, 227, 196], [DOOR]: [242, 225, 168], [DESK]: [138, 107, 74], [THING]: [224, 160, 48] };
const png = (w, h, rgb) => {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rgb(x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
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
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
mkdirSync(path.join(root, 'apps/web/public/office'), { recursive: true });
writeFileSync(
  path.join(root, 'apps/web/public/office/tiles.png'),
  png(T * 8, T, (x, y) => {
    const id = Math.floor(x / T) + 1;
    const [r, g, b] = colours[id];
    const edge = x % T === 0 || y % T === 0 || x % T === T - 1 || y % T === T - 1;
    const k = edge ? 0.88 : 1;
    return [Math.round(r * k), Math.round(g * k), Math.round(b * k)];
  }),
);

// ---- The map ----
const floor = Array(W * H).fill(FLOOR);
const wall = Array(W * H).fill(0);
const at = (x, y) => y * W + x;
const rect = (x, y, w, h, tile) => {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) floor[at(i, j)] = tile;
};
const solid = (x, y) => {
  floor[at(x, y)] = WALL;
  wall[at(x, y)] = 1;
};
const open = (x, y) => {
  floor[at(x, y)] = DOOR;
  wall[at(x, y)] = 0;
};
for (let x = 0; x < W; x++) {
  solid(x, 0);
  solid(x, H - 1);
}
for (let y = 0; y < H; y++) {
  solid(0, y);
  solid(W - 1, y);
}

// Top row: four department rooms, a corridor below them.
const top = [
  ['Chief of Staff', 'chief-of-staff', 1, 9],
  ['Lead Gen', 'lead-gen', 11, 9],
  ['Outreach', 'outreach', 21, 9],
  ['Research', 'research', 31, 8],
];
for (const [, , x, w] of top) rect(x, 1, w, 10, CARPET);
for (const wx of [10, 20, 30]) for (let y = 1; y <= 11; y++) solid(wx, y);
for (let x = 1; x < W - 1; x++) solid(x, 11);
for (const dx of [5, 15, 25, 34]) open(dx, 11);

// Bottom row: the Boardroom, the hall with the door, the lounge.
rect(1, 16, 14, 6, WOOD);
rect(25, 16, 14, 6, LOUNGE);
for (let y = 15; y <= 22; y++) {
  solid(15, y);
  solid(24, y);
}
for (let x = 1; x <= 14; x++) {
  solid(x, 15);
  solid(x, 22);
}
for (let x = 25; x <= 38; x++) {
  solid(x, 15);
  solid(x, 22);
}
open(8, 15);
open(31, 15);
open(19, 23);
open(20, 23);

const prop = (name, type, value) => ({ name, type, value });
let nextId = 1;
const obj = (name, type, x, y, w, h, properties) => ({ id: nextId++, name, type, x: x * T, y: y * T, ...(w ? { width: w * T, height: h * T } : { point: true }), rotation: 0, visible: true, ...(properties ? { properties } : {}) });

const rooms = [
  ...top.map(([name, dept, x, w]) => obj(name, '', x, 1, w, 10, [prop('kind', 'string', 'department'), prop('department', 'string', dept)])),
  obj('Boardroom', '', 1, 16, 14, 6, [prop('kind', 'string', 'boardroom'), prop('maxUsers', 'int', 12), prop('focusable', 'bool', true)]),
  obj('Hall', '', 16, 16, 8, 7, [prop('kind', 'string', 'hall')]),
  obj('Lounge', '', 25, 16, 14, 6, [prop('kind', 'string', 'lounge')]),
];
const desks = [];
for (const [name, , x] of top) {
  [[2, 2], [5, 2], [2, 5], [5, 5]].forEach(([dx, dy], i) => {
    desks.push(obj(`${name} desk ${i + 1}`, '', x + dx, 1 + dy, 0, 0, [prop('room', 'string', name), prop('slot', 'int', i + 1)]));
    floor[at(x + dx, 1 + dy)] = DESK;
  });
}
const objects = [
  obj('Approvals desk', 'approvals-desk', 19, 18),
  obj('Goal whiteboard', 'whiteboard', 17, 17),
  obj('Dashboard screen', 'screen', 22, 17),
  obj('Mailbox', 'mailbox', 22, 20),
  obj('Job board', 'jobboard', 27, 17),
  obj('Boardroom table', 'boardroom-table', 7, 18),
];
for (const o of objects) floor[at(o.x / T, o.y / T)] = THING;
const entries = [obj('door', '', 19, 22), obj('lounge', '', 30, 19), obj('boardroom', '', 7, 20)];

const group = (name, list) => ({ id: nextId++, name, type: 'objectgroup', draworder: 'topdown', opacity: 1, visible: true, x: 0, y: 0, objects: list });
const tiles = (name, data) => ({ id: nextId++, name, type: 'tilelayer', width: W, height: H, x: 0, y: 0, opacity: 1, visible: true, data });
const map = {
  compressionlevel: -1,
  width: W,
  height: H,
  tilewidth: T,
  tileheight: T,
  infinite: false,
  orientation: 'orthogonal',
  renderorder: 'right-down',
  tiledversion: '1.10.2',
  type: 'map',
  version: '1.10',
  tilesets: [{ firstgid: 1, name: 'office', image: 'tiles.png', imagewidth: T * 8, imageheight: T, tilewidth: T, tileheight: T, columns: 8, tilecount: 8, margin: 0, spacing: 0 }],
  layers: [tiles('floor', floor), tiles('collision', wall), group('rooms', rooms), group('desks', desks), group('objects', objects), group('entries', entries)],
  nextlayerid: nextId + 1,
  nextobjectid: nextId + 1,
};
writeFileSync(path.join(root, 'company/office.tmj'), JSON.stringify(map, null, 1) + '\n');
process.stdout.write(`wrote company/office.tmj (${W}x${H}) and apps/web/public/office/tiles.png
`);
