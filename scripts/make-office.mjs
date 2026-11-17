// Writes the starter office: company/office.tmj (a Tiled JSON map) and apps/web/public/office/tiles.png (the tiles it uses).
// The tiles are drawn here, flat colours, so the art is ours and has no license to track. Replace the PNG with Kenney tiles (CC0)
// or your own, or edit the map in Tiled; the OS reads the map file, not this script. Run: node scripts/make-office.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { DECOR_FOOT, OBJECT_FOOT } from './lib/footprints.mjs';
import { districts } from './lib/districts.mjs';

const root = path.resolve(import.meta.dirname, '..');
const T = 32;
const W = 40;
const H = 30;

// ---- The tiles: eight 32 by 32 squares in one row ----
const FLOOR = 1, WALL = 2, CARPET = 3, WOOD = 4, LOUNGE = 5, DOOR = 6, DESK = 7, THING = 8;
const GRASS = LOUNGE, PATH = DESK; // the green carpet is grass outdoors and the dark planks are a boardwalk
const colours = { [FLOOR]: [232, 228, 218], [WALL]: [59, 63, 74], [CARPET]: [201, 214, 232], [WOOD]: [216, 185, 138], [LOUNGE]: [207, 227, 196], [DOOR]: [242, 225, 168], [DESK]: [216, 185, 138], [THING]: [232, 228, 218] };
// A little deterministic grain, so a floor is not one flat colour. Same on every run.
const grain = (x, y, id) => {
  let h = (x * 374761393 + y * 668265263 + id * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) & 255) / 255;
};
const shade = ([r, g, b], k) => [Math.max(0, Math.min(255, Math.round(r * k))), Math.max(0, Math.min(255, Math.round(g * k))), Math.max(0, Math.min(255, Math.round(b * k)))];
/** One pixel of one tile. Tiles are drawn so neighbours join with no seam: patterns repeat every 8 or 16 pixels, never a border. */
const texel = (id, x, y) => {
  const base = colours[id];
  const n = grain(x, y, id);
  switch (id) {
    case WOOD:
    case DESK: {
      const plank = Math.floor(y / 8);
      const seam = (x + plank * 13) % 32 === 0; // a plank end, staggered row to row
      if (y % 8 === 7 || seam) return shade(base, 0.82);
      return shade(base, 0.96 + n * 0.08 + (plank % 2) * 0.03);
    }
    case CARPET:
      return shade(base, ((x >> 1) + (y >> 1)) % 2 === 0 ? 0.97 : 1.02 + n * 0.02);
    case LOUNGE:
      return shade(base, 0.97 + n * 0.06);
    case WALL:
      if (y < 5) return shade(base, 1.55); // the lit top edge
      if (y > 26) return shade(base, 0.7); // the shadow it casts
      return shade(base, (y % 8 === 7 || (x + (Math.floor(y / 8) % 2) * 8) % 16 === 0 ? 0.88 : 1) + n * 0.04);
    case DOOR:
      return (y >> 2) % 2 === 0 ? shade(base, 1) : shade(base, 0.95);
    default: // FLOOR, THING
      return shade(base, 0.985 + n * 0.03 + (((x >> 4) + (y >> 4)) % 2) * 0.012);
  }
};
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
    return texel(Math.floor(x / T) + 1, x % T, y);
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
/** Furniture you cannot walk through: the floor stays as it is. */
const block = (x, y, w = 1, h = 1) => {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) wall[at(i, j)] = 1;
};
for (let x = 0; x < W; x++) {
  solid(x, 0);
  solid(x, H - 1);
}
for (let y = 0; y < H; y++) {
  solid(0, y);
  solid(W - 1, y);
}

// ---- Top row: four department rooms (nine tiles wide, ten high), with a corridor below them. The stamp code (stamp.ts) relies on this. ----
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

// ---- Middle row (y 16 to 21): the Boardroom, the Hall (tall, with the front door at the bottom), the Lounge and the Cafe. ----
rect(1, 16, 14, 6, WOOD);
rect(25, 16, 7, 6, LOUNGE);
rect(33, 16, 6, 6, CARPET);
for (let y = 15; y <= 28; y++) {
  if (y !== 23) {
    solid(15, y);
    solid(24, y);
  }
}
for (let y = 15; y <= 22; y++) solid(32, y);
for (let x = 1; x <= 14; x++) {
  solid(x, 15);
  solid(x, 22);
}
for (let x = 25; x <= 38; x++) {
  solid(x, 15);
  solid(x, 22);
}
open(8, 15); // into the Boardroom
open(28, 15); // into the Lounge
open(35, 15); // into the Cafe
open(32, 19); // Lounge to Cafe
// The Hall is open to the corridor above, and runs down to the front door.
rect(16, 15, 8, 14, FLOOR);
// ---- Bottom row (y 25 to 28): a play room and a terrace, off a corridor along y 23. ----
rect(1, 25, 14, 4, CARPET);
rect(25, 25, 14, 4, LOUNGE); // grass
for (let x = 1; x <= 14; x++) solid(x, 24);
for (let x = 25; x <= 38; x++) solid(x, 24);
open(8, 24);
open(31, 24);
open(19, 29); // the front door
open(20, 29);

const prop = (name, type, value) => ({ name, type, value });
let nextId = 1;
const obj = (name, type, x, y, w, h, properties) => ({ id: nextId++, name, type, x: x * T, y: y * T, ...(w ? { width: w * T, height: h * T } : { point: true }), rotation: 0, visible: true, ...(properties ? { properties } : {}) });

const rooms = [
  ...top.map(([name, dept, x, w]) => obj(name, '', x, 1, w, 10, [prop('kind', 'string', 'department'), prop('department', 'string', dept)])),
  obj('Boardroom', '', 1, 16, 14, 6, [prop('kind', 'string', 'boardroom'), prop('maxUsers', 'int', 12), prop('focusable', 'bool', true)]),
  obj('Hall', '', 16, 16, 8, 13, [prop('kind', 'string', 'hall')]),
  obj('Lounge', '', 25, 16, 7, 6, [prop('kind', 'string', 'lounge')]),
  obj('Cafe', '', 33, 16, 6, 6, [prop('kind', 'string', 'cafe')]),
  obj('Play room', '', 1, 25, 14, 4, [prop('kind', 'string', 'play')]),
  obj('Terrace', '', 25, 25, 14, 4, [prop('kind', 'string', 'terrace')]),
];

// Agents sit at their desks: the desk is the tile north of the chair, the chair tile is where the agent stands.
const desks = [];
for (const [name, , x] of top) {
  // Three columns, two rows to start (six desks); a third row (slots 7 to 9) is added with "add a desk" (stamp.ts, DESK_SPOTS).
  [[1, 2], [4, 2], [7, 2], [1, 5], [4, 5], [7, 5]].forEach(([dx, dy], i) => {
    desks.push(obj(`${name} desk ${i + 1}`, '', x + dx, 1 + dy, 0, 0, [prop('room', 'string', name), prop('slot', 'int', i + 1)]));
    floor[at(x + dx, 1 + dy)] = DESK;
    block(x + dx, dy); // the desk itself, one row up from the chair
  });
}

// ---- What you use. Each opens a panel. Sizes come from scripts/lib/footprints.mjs and the tiles under them are blocked. ----
const objects = [];
const use = (name, type, x, y) => {
  objects.push(obj(name, type, x, y));
  const [w, h] = OBJECT_FOOT[type];
  block(x, y, w, h);
};
// The Boardroom: the goals whiteboard and the health screen on the wall, and a long table with chairs.
use('Goal whiteboard', 'whiteboard', 2, 16);
use('Dashboard screen', 'screen', 11, 16);
use('Boardroom table', 'boardroom-table', 5, 18);
// The Hall: reception by the door, approvals and the terminal, the mailbox.
use('Job board', 'jobboard', 21, 25);
use('Approvals desk', 'approvals-desk', 17, 26);
use('Terminal', 'terminal', 21, 19);
use('Mailbox', 'mailbox', 23, 22);
// Chief of Staff keeps the brief, the task board and the needs-you light; Lead Gen the pipeline; Outreach the campaigns; Research signals and ideas.
use('Task board', 'task-board', 8, 1);
use('Brief desk', 'brief-desk', 8, 4);
use('Needs you board', 'needs-you-board', 9, 8);
use('Pipeline board', 'pipeline-board', 19, 3);
use('Campaign board', 'campaign-board', 29, 3);
use('Idea wall', 'idea-wall', 37, 1);
use('Signal radio', 'signal-radio', 38, 4);
// Every department room has a board and a meeting table (S6-13b).
for (const [name, , x] of top) {
  use(`${name} board`, 'dept-board', x + 1, 1);
  use(`${name} table`, 'dept-table', x + 5, 9); // moves to rows 11 and 12 below, when the rooms grow taller
}
for (const o of objects) floor[at(o.x / T, o.y / T)] = THING;

// ---- Scenery: only there to look right. Each is [picture, x, y]; blocking ones stop you walking through. ----
const decor = [];
const dec = (name, x, y, { solidly = true } = {}) => {
  const [w, h] = DECOR_FOOT[name];
  decor.push(obj(name, 'decor', x, y, w, h));
  if (solidly) block(x, y, w, h);
};
// Desks and chairs are not listed here: the world draws one of each at every desk in the desks layer, so a desk added later has them too.
for (const [, , x] of top) {
  dec('bookshelf', x + 4, 1); // along the north wall
  dec('plant', x, 10);
  dec('bin', x + 7, 10);
}
dec('printer', 19, 9);
dec('coffee', 1, 9);
// Boardroom: plants either end.
dec('plant', 1, 21);
dec('plant', 14, 21);
dec('bin', 14, 16);
dec('bookshelf', 6, 16);
decor.push(obj('rug', 'decor', 5, 18, 4, 3)); // a soft rug under the table
// Hall: a rug by the door, plants, a clock, a water cooler of plants.
decor.push(obj('rug', 'decor', 18, 25, 4, 3));
dec('plant', 16, 28);
dec('plant', 23, 28);
dec('plant', 16, 22);
dec('clock', 13, 16, { solidly: false });
// Lounge: sofas facing a rug, armchairs, plants.
decor.push(obj('rug', 'decor', 26, 18, 4, 3));
dec('sofa', 26, 17);
dec('sofa', 29, 17);
dec('armchair', 25, 19);
dec('armchair', 25, 20);
dec('plant', 31, 16);
dec('plant', 31, 21);
// Cafe: a counter with the coffee machine, a fridge, tables with their chairs.
dec('coffee', 36, 16);
dec('fridge', 38, 16);
dec('cafe-table', 34, 19);
dec('cafe-table', 36, 19);
dec('cafe-table', 34, 21);
dec('bin', 38, 21);
dec('plant', 33, 21);
// Play room: ping pong, arcade machines, a sofa.
dec('pingpong', 3, 26);
dec('arcade', 10, 25);
dec('arcade', 12, 25);
dec('sofa', 9, 28);
dec('plant', 1, 25);
dec('plant', 14, 25);
// Terrace: trees, benches (sofas), a table.
dec('tree', 26, 25);
dec('tree', 36, 25);
dec('tree', 33, 25);
dec('cafe-table', 29, 27);
dec('sofa', 33, 27);
dec('plant', 25, 28);
dec('plant', 38, 28);
const entries = [obj('door', '', 19, 28), obj('lounge', '', 28, 19), obj('boardroom', '', 7, 20)];

// ---- Rooms that grow (S6B-1): department rooms are twelve rows high. Two rows go in at row 9 and everything from there down moves. ----
const INS_AT = 9;
const INS_N = 2;
const H2 = H + INS_N;
{
  const nf = Array(W * H2).fill(FLOOR);
  const nw = Array(W * H2).fill(0);
  for (let y = 0; y < H2; y++)
    for (let x = 0; x < W; x++) {
      const from = y < INS_AT ? y : y < INS_AT + INS_N ? INS_AT - 1 : y - INS_N; // new rows copy the row above them, without furniture
      let tile = floor[at(x, from)];
      if (y >= INS_AT && y < INS_AT + INS_N && (tile === THING || tile === DESK || tile === DOOR)) tile = CARPET;
      nf[y * W + x] = tile;
      nw[y * W + x] = y >= INS_AT && y < INS_AT + INS_N ? (tile === WALL ? 1 : 0) : wall[at(x, from)];
    }
  floor.splice(0, floor.length, ...nf);
  wall.splice(0, wall.length, ...nw);
  const shift = (o) => {
    const ty = o.y / T;
    if (ty >= INS_AT) o.y += INS_N * T;
    else if (o.height && ty + o.height / T > INS_AT) o.height += INS_N * T; // a room that spans the new rows gets taller
  };
  for (const list of [rooms, desks, objects, decor, entries]) list.forEach(shift);
}
// The street starts under the (taller) headquarters.
const STREET_Y = H2;

// ---- The town (S6-17): the headquarters above, a street under it, the districts along the street, one world with no switcher. ----
// Land beside the headquarters is a fenced lawn (where new departments get their rooms); the districts stand along the street.
// two rows of street, from STREET_Y
const GAP = 2; // lawn between districts
let reach = 1;
const placed = districts.map((d) => {
  const ox = reach;
  reach += d.w + GAP;
  return { d, ox };
});
const BW = Math.max(W, reach - GAP + 1);
const BH = STREET_Y + 2 + Math.max(...districts.map((d) => d.h)) + 1;
const bigFloor = Array(BW * BH).fill(GRASS);
const bigWall = Array(BW * BH).fill(1); // fenced unless opened below
const bat = (x, y) => y * BW + x;
for (let y = 0; y < H2; y++)
  for (let x = 0; x < W; x++) {
    bigFloor[bat(x, y)] = floor[at(x, y)];
    bigWall[bat(x, y)] = wall[at(x, y)];
  }
for (let y = STREET_Y; y < STREET_Y + 2; y++)
  for (let x = 1; x < BW - 1; x++) {
    bigFloor[bat(x, y)] = PATH;
    bigWall[bat(x, y)] = 0;
  }
for (const { d, ox } of placed) {
  for (let y = 0; y < d.h; y++)
    for (let x = 0; x < d.w; x++) {
      bigFloor[bat(ox + x, STREET_Y + 2 + y)] = d.floor[y * d.w + x];
      bigWall[bat(ox + x, STREET_Y + 2 + y)] = d.wall[y * d.w + x];
    }
  for (const r of d.rooms) rooms.push(obj(`${d.title}: ${r.name}`, '', ox + r.x, STREET_Y + 2 + r.y, r.w, r.h, [prop('kind', 'string', r.kind)]));
  for (const c of d.decor) decor.push(obj(c.name, 'decor', ox + c.x, STREET_Y + 2 + c.y, c.w, c.h, c.turn ? [prop('turn', 'int', c.turn)] : undefined));
  for (const e of d.entries) entries.push(obj(e.name, '', ox + e.x, STREET_Y + 2 + e.y));
}
// A brick fence round the whole town.
for (let x = 0; x < BW; x++) for (const y of [0, BH - 1]) {
  bigFloor[bat(x, y)] = WALL;
  bigWall[bat(x, y)] = 1;
}
for (let y = 0; y < BH; y++) for (const x of [0, BW - 1]) {
  bigFloor[bat(x, y)] = WALL;
  bigWall[bat(x, y)] = 1;
}
// The Park: the lower half of the lawn beside the headquarters is open grounds (the strip above stays fenced, for the rooms new
// departments get). A boardwalk, trees, picnic tables and benches, joined to the street.
const PARK_Y = 19; // below the strip where new departments get their rooms (their walls reach row 17)
for (let y = PARK_Y; y < STREET_Y; y++) for (let x = W; x < BW - 1; x++) bigWall[bat(x, y)] = 0;
for (let y = 23; y < 25; y++) for (let x = W; x < BW - 1; x++) bigFloor[bat(x, y)] = PATH;
const blockBig = (x, y, w, h) => {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) bigWall[bat(i, j)] = 1;
};
const scenery = (name, x, y) => {
  const [w, h] = DECOR_FOOT[name];
  decor.push(obj(name, 'decor', x, y, w, h));
  blockBig(x, y, w, h);
};
rooms.push(obj('Park', '', W + 1, PARK_Y + 1, BW - W - 3, STREET_Y - PARK_Y - 2, [prop('kind', 'string', 'terrace')]));
for (let x = W + 4; x < BW - 8; x += 10) {
  scenery('tree', x, PARK_Y + 1);
  scenery('tree', x + 5, 26);
  scenery('cafe-table', x + 1, 27);
  scenery('sofa', x + 3, 20);
  scenery('plant', x + 7, 21);
  scenery('bookshelf', x + 6, 28);
}
// Trees and plants along the street.
for (let x = 4; x < BW - 3; x += 9) decor.push(obj('plant', 'decor', x, STREET_Y + 2, 1, 1));

const group = (name, list) => ({ id: nextId++, name, type: 'objectgroup', draworder: 'topdown', opacity: 1, visible: true, x: 0, y: 0, objects: list });
const tiles = (name, data) => ({ id: nextId++, name, type: 'tilelayer', width: BW, height: BH, x: 0, y: 0, opacity: 1, visible: true, data });
const map = {
  compressionlevel: -1,
  width: BW,
  height: BH,
  tilewidth: T,
  tileheight: T,
  infinite: false,
  orientation: 'orthogonal',
  renderorder: 'right-down',
  tiledversion: '1.10.2',
  type: 'map',
  version: '1.10',
  tilesets: [{ firstgid: 1, name: 'office', image: 'tiles.png', imagewidth: T * 8, imageheight: T, tilewidth: T, tileheight: T, columns: 8, tilecount: 8, margin: 0, spacing: 0 }],
  layers: [tiles('floor', bigFloor), tiles('collision', bigWall), group('rooms', rooms), group('desks', desks), group('objects', objects), group('decor', decor), group('entries', entries)],
  nextlayerid: nextId + 1,
  nextobjectid: nextId + 1,
};
writeFileSync(path.join(root, 'company/office.tmj'), JSON.stringify(map, null, 1) + '\n');
// A new company starts from the same office (the starter company template).
mkdirSync(path.join(root, 'templates/companies/starter'), { recursive: true });
writeFileSync(path.join(root, 'templates/companies/starter/office.tmj'), JSON.stringify(map, null, 1) + '\n');
process.stdout.write(`wrote company/office.tmj (${BW}x${BH}) and apps/web/public/office/tiles.png
`);
