// Writes the extra worlds: company/worlds/<key>.tmj (and the same in the starter company template). Run: node scripts/make-worlds.mjs
// A world is a Tiled map like the office, but a social place: no department rooms and no numbered desks. It has a "door" to arrive by,
// rooms with a kind (lounge, cafe, play, meeting, hall, terrace) and a layer of scenery. Agents rest in its lounge, and people can meet
// and chat in it. Drawn from the same tiles and scenery pictures as the office, so there is no new art to track.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DECOR_FOOT } from './lib/footprints.mjs';

const root = path.resolve(import.meta.dirname, '..');
const T = 32;
// Tile ids in tiles.png (the same as the office).
const FLOOR = 1, WALL = 2, CARPET = 3, WOOD = 4, GRASS = 5, MAT = 6, PATH = 7;

function world({ key, title, blurb, w, h, fill }, draw) {
  const floor = Array(w * h).fill(fill);
  const wall = Array(w * h).fill(0);
  const at = (x, y) => y * w + x;
  let nextId = 1;
  const prop = (name, type, value) => ({ name, type, value });
  const obj = (name, type, x, y, ow, oh, properties) => ({ id: nextId++, name, type, x: x * T, y: y * T, ...(ow ? { width: ow * T, height: oh * T } : { point: true }), rotation: 0, visible: true, ...(properties ? { properties } : {}) });
  const rooms = [];
  const decor = [];
  const entries = [];
  const api = {
    w,
    h,
    rect(x, y, rw, rh, tile) {
      for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) floor[at(i, j)] = tile;
    },
    solid(x, y) {
      floor[at(x, y)] = WALL;
      wall[at(x, y)] = 1;
    },
    /** A wall all round a rectangle. */
    walls(x, y, rw, rh) {
      for (let i = x; i < x + rw; i++) {
        api.solid(i, y);
        api.solid(i, y + rh - 1);
      }
      for (let j = y; j < y + rh; j++) {
        api.solid(x, j);
        api.solid(x + rw - 1, j);
      }
    },
    /** A gap in a wall, with a mat on the floor. */
    gap(x, y) {
      floor[at(x, y)] = MAT;
      wall[at(x, y)] = 0;
    },
    block(x, y, bw = 1, bh = 1) {
      for (let j = y; j < y + bh; j++) for (let i = x; i < x + bw; i++) wall[at(i, j)] = 1;
    },
    room(name, kind, x, y, rw, rh, extra = []) {
      rooms.push(obj(name, '', x, y, rw, rh, [prop('kind', 'string', kind), ...extra]));
    },
    dec(name, x, y, { solidly = true, turn = 0 } = {}) {
      const foot = DECOR_FOOT[name];
      if (!foot) throw new Error(`no scenery picture called ${name}`);
      decor.push(obj(name, 'decor', x, y, foot[0], foot[1], turn ? [prop('turn', 'int', turn)] : undefined));
      if (solidly) api.block(x, y, foot[0], foot[1]);
    },
    door(x, y) {
      entries.push(obj('door', '', x, y));
    },
    lounge(x, y) {
      entries.push(obj('lounge', '', x, y));
    },
  };
  draw(api);
  // The edge of the map always blocks, so nobody walks off it.
  // A doorway (a mat) on the edge stays open.
  const edge = (x, y) => {
    if (floor[at(x, y)] !== MAT) wall[at(x, y)] = 1;
  };
  for (let x = 0; x < w; x++) {
    edge(x, 0);
    edge(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    edge(0, y);
    edge(w - 1, y);
  }
  const group = (name, list) => ({ id: nextId++, name, type: 'objectgroup', draworder: 'topdown', opacity: 1, visible: true, x: 0, y: 0, objects: list });
  const tiles = (name, data) => ({ id: nextId++, name, type: 'tilelayer', width: w, height: h, x: 0, y: 0, opacity: 1, visible: true, data });
  const map = {
    compressionlevel: -1,
    width: w,
    height: h,
    tilewidth: T,
    tileheight: T,
    infinite: false,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tiledversion: '1.10.2',
    type: 'map',
    version: '1.10',
    properties: [prop('title', 'string', title), prop('blurb', 'string', blurb)],
    tilesets: [{ firstgid: 1, name: 'office', image: 'tiles.png', imagewidth: T * 8, imageheight: T, tilewidth: T, tileheight: T, columns: 8, tilecount: 8, margin: 0, spacing: 0 }],
    layers: [tiles('floor', floor), tiles('collision', wall), group('rooms', rooms), group('desks', []), group('objects', []), group('decor', decor), group('entries', entries)],
    nextlayerid: nextId + 1,
    nextobjectid: nextId + 1,
  };
  for (const dir of ['company/worlds', 'templates/companies/starter/worlds']) {
    mkdirSync(path.join(root, dir), { recursive: true });
    writeFileSync(path.join(root, dir, `${key}.tmj`), JSON.stringify(map, null, 1) + '\n');
  }
  process.stdout.write(`wrote ${key}.tmj (${w}x${h})\n`);
}

// ---- Campus Green: a park with a cafe, a pavilion, a library and a sports corner, joined by boardwalks round a plaza. ----
world({ key: 'campus', title: 'Campus Green', blurb: 'A park to walk and talk in: a cafe, a pavilion, a library and a sports corner.', w: 48, h: 30, fill: GRASS }, (m) => {
  m.rect(23, 1, 2, 28, PATH); // boardwalk, north to south
  m.rect(2, 14, 44, 2, PATH); // and east to west
  m.rect(18, 11, 12, 8, FLOOR); // the plaza
  // Cafe (top left).
  m.walls(3, 2, 12, 8);
  m.rect(4, 3, 10, 6, WOOD);
  m.gap(8, 9);
  m.room('Cafe', 'cafe', 4, 3, 10, 6);
  m.dec('coffee', 4, 3);
  m.dec('fridge', 13, 3);
  m.dec('cafe-table', 5, 6);
  m.dec('cafe-table', 9, 6);
  m.dec('cafe-table', 11, 7);
  m.dec('plant', 4, 8);
  m.dec('bin', 13, 8);
  // Pavilion (top right): rows of sofas round a rug.
  m.walls(33, 2, 12, 8);
  m.rect(34, 3, 10, 6, CARPET);
  m.gap(38, 9);
  m.room('Pavilion', 'meeting', 34, 3, 10, 6);
  m.dec('rug', 37, 4, { solidly: false });
  m.dec('sofa', 35, 3);
  m.dec('sofa', 40, 3);
  m.dec('armchair', 35, 6);
  m.dec('armchair', 42, 6);
  m.dec('plant', 34, 8);
  m.dec('plant', 43, 8);
  // Library (bottom left).
  m.walls(3, 19, 12, 8);
  m.rect(4, 20, 10, 6, WOOD);
  m.gap(8, 19);
  m.room('Library', 'lounge', 4, 20, 10, 6);
  m.dec('bookshelf', 4, 20);
  m.dec('bookshelf', 6, 20);
  m.dec('bookshelf', 8, 20);
  m.dec('bookshelf', 10, 20);
  m.dec('rug', 6, 22, { solidly: false });
  m.dec('armchair', 5, 23);
  m.dec('armchair', 11, 23);
  m.dec('sofa', 7, 22);
  m.dec('plant', 13, 25);
  // Sports corner (bottom right): ping-pong in the open.
  m.rect(33, 19, 12, 8, FLOOR);
  m.room('Sports corner', 'play', 33, 19, 12, 8);
  m.dec('pingpong', 34, 20);
  m.dec('pingpong', 39, 20);
  m.dec('arcade', 34, 24);
  m.dec('arcade', 36, 24);
  m.dec('sofa', 40, 24);
  m.dec('bin', 44, 26);
  // The plaza.
  m.room('Plaza', 'hall', 18, 11, 12, 8);
  m.dec('tree', 18, 11);
  m.dec('tree', 28, 11);
  m.dec('tree', 18, 17);
  m.dec('tree', 28, 17);
  m.dec('cafe-table', 22, 12);
  m.dec('cafe-table', 25, 12);
  m.dec('clock', 24, 11, { solidly: false });
  // Trees and plants along the edges and beside the paths.
  for (const [x, y] of [[17, 3], [19, 6], [28, 3], [30, 7], [17, 22], [19, 26], [28, 23], [30, 26], [2, 12], [45, 12], [2, 17], [45, 17]]) m.dec('tree', x, y);
  m.door(23, 27);
  m.lounge(8, 23);
});

// ---- Co-working Loft: an open floor of desk rows, phone pods, a meeting corner, a library and a kitchen. ----
world({ key: 'loft', title: 'Co-working Loft', blurb: 'An open-plan floor with desk rows, quiet pods, a library nook and a kitchen.', w: 44, h: 28, fill: WOOD }, (m) => {
  m.walls(0, 0, 44, 28);
  // Desk clusters: two rows of desks face each other over a gap, a chair at each.
  for (const x0 of [3, 11, 19]) {
    for (let i = 0; i < 4; i++) {
      m.dec('desk', x0 + i * 1, 3);
      m.dec('chair', x0 + i, 4, { turn: 180 });
      m.dec('desk', x0 + i, 8);
      m.dec('chair', x0 + i, 7, { turn: 0 });
    }
  }
  for (const x0 of [3, 11, 19]) {
    for (let i = 0; i < 4; i++) {
      m.dec('desk', x0 + i, 11);
      m.dec('chair', x0 + i, 12, { turn: 180 });
    }
  }
  m.rect(1, 1, 27, 14, FLOOR); // a light floor, so the desks and chairs stand out
  m.room('Open floor', 'hall', 1, 1, 27, 14);
  m.dec('printer', 26, 2);
  m.dec('bin', 26, 5);
  m.dec('plant', 1, 1);
  m.dec('plant', 27, 14);
  // Phone pods (top right): small walled rooms.
  for (const [i, x] of [30, 34, 38].entries()) {
    m.walls(x, 1, 4, 5);
    m.rect(x + 1, 2, 2, 3, CARPET);
    m.gap(x + 1, 5);
    m.room(`Pod ${i + 1}`, 'meeting', x + 1, 2, 2, 3);
    m.dec('armchair', x + 1, 2);
    m.dec('plant', x + 2, 2);
  }
  // Meeting corner (right middle).
  m.walls(29, 8, 14, 8);
  m.rect(30, 9, 12, 6, CARPET);
  m.gap(29, 12);
  m.room('Meeting corner', 'lounge', 30, 9, 12, 6);
  m.dec('rug', 33, 10, { solidly: false });
  m.dec('sofa', 31, 9);
  m.dec('sofa', 38, 9);
  m.dec('cafe-table', 34, 13);
  m.dec('armchair', 31, 13);
  m.dec('plant', 41, 14);
  // Library (bottom left).
  m.rect(1, 17, 20, 10, WOOD);
  m.room('Library', 'lounge', 1, 17, 20, 10);
  for (const x of [2, 4, 6, 8, 10, 12]) m.dec('bookshelf', x, 18);
  m.dec('rug', 4, 21, { solidly: false });
  m.dec('sofa', 5, 21);
  m.dec('armchair', 3, 23);
  m.dec('armchair', 9, 23);
  m.dec('plant', 19, 25);
  m.dec('tree', 17, 18);
  // Kitchen (bottom right).
  m.rect(23, 17, 20, 10, FLOOR);
  m.room('Kitchen', 'cafe', 23, 17, 20, 10);
  m.dec('coffee', 24, 18);
  m.dec('coffee', 27, 18);
  m.dec('fridge', 31, 18);
  m.dec('fridge', 33, 18);
  m.dec('cafe-table', 25, 22);
  m.dec('cafe-table', 29, 22);
  m.dec('cafe-table', 34, 22);
  m.dec('bin', 41, 25);
  m.dec('plant', 41, 18);
  m.door(21, 26);
  for (const x of [21, 22]) m.gap(x, 27);
  m.lounge(8, 22);
});

// ---- Game Night: arcade cabinets, ping-pong, a snack bar and a cinema nook. ----
world({ key: 'arcade', title: 'Game Night', blurb: 'Arcade cabinets, ping-pong tables, a snack bar and a sofa nook for when the work is done.', w: 40, h: 26, fill: CARPET }, (m) => {
  m.walls(0, 0, 40, 26);
  m.room('Arcade', 'play', 1, 1, 22, 9);
  for (let i = 0; i < 9; i++) m.dec('arcade', 2 + i * 2, 1);
  for (let i = 0; i < 5; i++) m.dec('arcade', 3 + i * 4, 6, { turn: 0 });
  m.dec('rug', 15, 4, { solidly: false });
  m.dec('sofa', 17, 8);
  m.dec('plant', 21, 9);
  // Table tennis.
  m.room('Table tennis', 'play', 1, 11, 22, 13);
  m.dec('pingpong', 3, 13);
  m.dec('pingpong', 10, 13);
  m.dec('pingpong', 3, 18);
  m.dec('pingpong', 10, 18);
  m.dec('sofa', 16, 14);
  m.dec('sofa', 16, 19);
  m.dec('armchair', 20, 22);
  m.dec('plant', 21, 12);
  m.dec('plant', 1, 23);
  // Snack bar.
  m.rect(24, 1, 15, 9, WOOD);
  m.room('Snack bar', 'cafe', 24, 1, 15, 9);
  m.dec('coffee', 25, 1);
  m.dec('coffee', 28, 1);
  m.dec('fridge', 37, 1);
  m.dec('cafe-table', 26, 5);
  m.dec('cafe-table', 30, 5);
  m.dec('cafe-table', 34, 5);
  m.dec('bin', 37, 8);
  // Cinema nook.
  m.rect(24, 11, 15, 13, GRASS);
  m.room('Cinema nook', 'lounge', 24, 11, 15, 13);
  m.dec('rug', 27, 14, { solidly: false });
  m.dec('sofa', 26, 12);
  m.dec('sofa', 30, 12);
  m.dec('armchair', 26, 18);
  m.dec('armchair', 33, 18);
  m.dec('sofa', 28, 21);
  m.dec('plant', 37, 12);
  m.dec('plant', 37, 22);
  m.dec('tree', 35, 16);
  // Walls between, with ways through.
  for (let y = 1; y < 25; y++) m.solid(23, y);
  for (let x = 1; x < 23; x++) m.solid(x, 10);
  for (let x = 24; x < 39; x++) m.solid(x, 10);
  for (const [x, y] of [[23, 5], [23, 17], [12, 10], [31, 10]]) m.gap(x, y);
  m.gap(19, 25);
  m.gap(20, 25);
  m.door(19, 24);
  m.lounge(30, 16);
});

// ---- Rooftop: a sun deck with sofas and trees, a bar and a green corner. ----
world({ key: 'rooftop', title: 'Rooftop', blurb: 'A sun deck above the city: sofas, trees, a bar and a quiet green corner.', w: 36, h: 22, fill: GRASS }, (m) => {
  m.walls(0, 0, 36, 22);
  m.rect(1, 10, 20, 2, PATH); // a boardwalk through the deck
  m.rect(10, 1, 2, 20, PATH);
  m.room('Sun deck', 'lounge', 1, 1, 20, 20);
  m.dec('rug', 3, 3, { solidly: false });
  m.dec('sofa', 4, 3);
  m.dec('sofa', 7, 3);
  m.dec('armchair', 3, 5);
  m.dec('rug', 14, 14, { solidly: false });
  m.dec('sofa', 15, 14);
  m.dec('sofa', 18, 16);
  m.dec('armchair', 14, 17);
  m.dec('cafe-table', 4, 15);
  m.dec('cafe-table', 7, 17);
  m.dec('cafe-table', 15, 4);
  m.dec('cafe-table', 17, 7);
  for (const [x, y] of [[1, 1], [19, 1], [1, 19], [19, 19], [8, 8], [13, 12], [6, 12], [16, 11], [13, 8]]) m.dec('tree', x, y);
  // The bar.
  m.walls(22, 1, 13, 9);
  m.rect(23, 2, 11, 7, WOOD);
  m.gap(22, 6);
  m.room('Bar', 'cafe', 23, 2, 11, 7);
  m.dec('coffee', 24, 2);
  m.dec('coffee', 27, 2);
  m.dec('fridge', 32, 2);
  m.dec('cafe-table', 24, 5);
  m.dec('cafe-table', 28, 5);
  m.dec('cafe-table', 31, 7);
  m.dec('bin', 33, 8);
  // The green corner.
  m.rect(22, 11, 13, 10, GRASS);
  m.room('Green corner', 'terrace', 22, 11, 13, 10);
  for (const [x, y] of [[23, 12], [32, 12], [23, 18], [32, 18]]) m.dec('tree', x, y);
  m.dec('sofa', 27, 14);
  m.dec('plant', 26, 12);
  m.dec('plant', 30, 19);
  m.door(10, 20);
  m.lounge(4, 10);
});
