// The districts of the town (S6-17): Campus Green, Co-working Loft, Game Night and Rooftop. Each is built here as plain data (tiles,
// walls, rooms, scenery, entries) and make-office.mjs places them below the headquarters, along a street, in the one big map.
// Drawn from the same tiles and scenery pictures as the headquarters, so there is no new art to track.
import { DECOR_FOOT } from './footprints.mjs';

// Tile ids in tiles.png (the same as the office).
export const TILE = { FLOOR: 1, WALL: 2, CARPET: 3, WOOD: 4, GRASS: 5, MAT: 6, PATH: 7 };
const { FLOOR, WALL, CARPET, WOOD, GRASS, MAT, PATH } = TILE;

export function district({ key, title, w, h, fill }, draw) {
  const floor = Array(w * h).fill(fill);
  const wall = Array(w * h).fill(0);
  const at = (x, y) => y * w + x;
  const rooms = [];
  const decor = [];
  const entries = [];
  const m = {
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
        m.solid(i, y);
        m.solid(i, y + rh - 1);
      }
      for (let j = y; j < y + rh; j++) {
        m.solid(x, j);
        m.solid(x + rw - 1, j);
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
    room(name, kind, x, y, rw, rh) {
      rooms.push({ name, kind, x, y, w: rw, h: rh });
    },
    dec(name, x, y, { solidly = true, turn = 0 } = {}) {
      const foot = DECOR_FOOT[name];
      if (!foot) throw new Error(`no scenery picture called ${name}`);
      decor.push({ name, x, y, w: foot[0], h: foot[1], turn });
      if (solidly) m.block(x, y, foot[0], foot[1]);
    },
    lounge(x, y) {
      entries.push({ name: `${key}-lounge`, x, y });
    },
  };
  draw(m);
  // The edge of the district always blocks, so nobody walks off it, except at a doorway (a mat).
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
  return { key, title, w, h, floor, wall, rooms, decor, entries };
}

// ---- Campus Green: a park with a cafe, a pavilion, a library and a sports corner, joined by boardwalks round a plaza. ----
const campus = district({ key: 'campus', title: 'Campus Green', w: 48, h: 30, fill: GRASS }, (m) => {
  m.rect(23, 1, 2, 28, PATH); // boardwalk, north to south
  m.rect(2, 14, 44, 2, PATH); // and east to west
  m.rect(18, 11, 12, 8, FLOOR); // the plaza
  m.gap(23, 0); // the way in from the street
  m.gap(24, 0);
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
  // Pavilion (top right): sofas round a rug.
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
  for (const x of [4, 6, 10, 12]) m.dec('bookshelf', x, 20); // not at 8 or 9: that is the way in from the door
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
  for (const [x, y] of [[18, 11], [28, 11], [18, 17], [28, 17]]) m.dec('tree', x, y);
  m.dec('cafe-table', 22, 12);
  m.dec('cafe-table', 25, 12);
  m.dec('clock', 24, 11, { solidly: false });
  // Trees along the edges and beside the paths.
  for (const [x, y] of [[17, 3], [19, 6], [28, 3], [30, 7], [17, 22], [19, 26], [28, 23], [30, 26], [2, 12], [45, 12], [2, 17], [45, 17]]) m.dec('tree', x, y);
  m.lounge(8, 23);
});

// ---- Co-working Loft: an open floor of desk rows, phone pods, a meeting corner, a library and a kitchen. ----
const loft = district({ key: 'loft', title: 'Co-working Loft', w: 44, h: 28, fill: WOOD }, (m) => {
  m.walls(0, 0, 44, 28);
  m.gap(13, 0); // the way in from the street
  m.gap(14, 0);
  m.rect(1, 1, 27, 14, FLOOR); // a light floor, so the desks and chairs stand out
  // Desk clusters: two rows of desks face each other over a gap, a chair at each.
  for (const x0 of [3, 11, 19]) {
    for (let i = 0; i < 4; i++) {
      m.dec('desk', x0 + i, 3);
      m.dec('chair', x0 + i, 4, { turn: 180 });
      m.dec('desk', x0 + i, 8);
      m.dec('chair', x0 + i, 7, { turn: 0 });
      m.dec('desk', x0 + i, 11);
      m.dec('chair', x0 + i, 12, { turn: 180 });
    }
  }
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
  m.lounge(8, 22);
});

// ---- Game Night: arcade cabinets, ping-pong, a snack bar and a cinema nook. ----
const arcade = district({ key: 'arcade', title: 'Game Night', w: 40, h: 26, fill: CARPET }, (m) => {
  m.walls(0, 0, 40, 26);
  m.gap(21, 0); // the way in from the street
  m.gap(22, 0);
  m.room('Arcade', 'play', 1, 1, 22, 9);
  for (let i = 0; i < 9; i++) if (2 + i * 2 !== 20 && 2 + i * 2 !== 22) m.dec('arcade', 2 + i * 2, 1);
  for (let i = 0; i < 5; i++) m.dec('arcade', 3 + i * 4, 6);
  m.dec('rug', 15, 4, { solidly: false });
  m.dec('sofa', 17, 8);
  m.dec('plant', 21, 9);
  // Table tennis.
  m.room('Table tennis', 'play', 1, 11, 22, 13);
  for (const [x, y] of [[3, 13], [10, 13], [3, 18], [10, 18]]) m.dec('pingpong', x, y);
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
  for (const x of [26, 30, 34]) m.dec('cafe-table', x, 5);
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
  for (let x = 1; x < 39; x++) m.solid(x, 10);
  for (const [x, y] of [[23, 5], [23, 17], [12, 10], [31, 10]]) m.gap(x, y);
  m.lounge(30, 16);
});

// ---- Rooftop: a sun deck with sofas and trees, a bar and a green corner. ----
const rooftop = district({ key: 'rooftop', title: 'Rooftop', w: 36, h: 22, fill: GRASS }, (m) => {
  m.walls(0, 0, 36, 22);
  m.gap(10, 0); // the way in from the street
  m.gap(11, 0);
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
  for (const [x, y] of [[4, 15], [7, 17], [15, 4], [17, 7]]) m.dec('cafe-table', x, y);
  for (const [x, y] of [[1, 1], [19, 1], [1, 19], [19, 19], [8, 8], [13, 12], [6, 12], [16, 11], [13, 8]]) m.dec('tree', x, y);
  // The bar.
  m.walls(22, 1, 13, 9);
  m.rect(23, 2, 11, 7, WOOD);
  m.gap(22, 6);
  m.room('Bar', 'cafe', 23, 2, 11, 7);
  m.dec('coffee', 24, 2);
  m.dec('coffee', 27, 2);
  m.dec('fridge', 32, 2);
  for (const [x, y] of [[24, 5], [28, 5], [31, 7]]) m.dec('cafe-table', x, y);
  m.dec('bin', 33, 8);
  // The green corner.
  m.rect(22, 11, 13, 10, GRASS);
  m.room('Green corner', 'terrace', 22, 11, 13, 10);
  for (const [x, y] of [[23, 12], [32, 12], [23, 18], [32, 18]]) m.dec('tree', x, y);
  m.dec('sofa', 27, 14);
  m.dec('plant', 26, 12);
  m.dec('plant', 30, 19);
  m.lounge(4, 10);
});

/** In the order they stand along the street, west to east. */
export const districts = [campus, loft, arcade, rooftop];
