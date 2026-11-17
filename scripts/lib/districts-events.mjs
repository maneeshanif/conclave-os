// The second row of the town (S6C-1): places for events, in the spirit of the template maps on workadventu.re (a conference campus, a
// hackathon with team offices, a job fair, a meeting centre). Built from our own tiles and scenery, like the first row.
import { district, TILE } from './districts.mjs';

const { FLOOR, CARPET, WOOD, GRASS, PATH } = TILE;
const FLAT = { solidly: false };

// ---- Conference Campus: an auditorium with a stage and rows of seats, three workshop rooms, a kiosk, a registration desk, a sports ground and a garden party. ----
const conference = district({ key: 'conference', title: 'Conference Campus', w: 60, h: 34, fill: GRASS }, (m) => {
  m.rect(30, 1, 2, 33, PATH); // a boardwalk down the middle
  m.rect(2, 22, 56, 2, PATH); // and across
  m.gap(30, 0); // the way in from the street
  m.gap(31, 0);
  // The auditorium.
  m.walls(1, 1, 28, 19);
  m.rect(2, 2, 26, 17, WOOD);
  m.gap(14, 19);
  m.gap(15, 19);
  m.room('Auditorium', 'meeting', 2, 2, 26, 17);
  m.dec('screen-wide', 12, 2, FLAT);
  m.dec('stage', 10, 3, FLAT);
  m.dec('lectern', 13, 4);
  m.dec('banner', 3, 3);
  m.dec('banner2', 26, 3);
  for (const y of [9, 11, 13, 15, 17]) {
    for (let x = 4; x <= 11; x++) m.dec('seat', x, y);
    for (let x = 18; x <= 25; x++) m.dec('seat', x, y);
  }
  m.dec('plant', 2, 18);
  m.dec('plant', 27, 18);
  // Three workshop rooms (top right).
  for (const [i, x] of [33, 42, 51].entries()) {
    m.walls(x, 1, 8, 8);
    m.rect(x + 1, 2, 6, 6, CARPET);
    m.gap(x + 4, 8);
    m.room(`Workshop ${i + 1}`, 'meeting', x + 1, 2, 6, 6);
    m.dec('screen-wide', x + 2, 2, FLAT);
    m.dec('cafe-table', x + 1, 4);
    m.dec('cafe-table', x + 4, 4);
    m.dec('cafe-table', x + 1, 6);
    m.dec('plant', x + 6, 7);
  }
  // A kiosk.
  m.walls(33, 12, 12, 8);
  m.rect(34, 13, 10, 6, WOOD);
  m.gap(37, 19);
  m.room('Kiosk', 'cafe', 34, 13, 10, 6);
  m.dec('coffee', 34, 13);
  m.dec('fridge', 43, 13);
  for (const [x, y] of [[35, 16], [39, 16], [38, 14]]) m.dec('cafe-table', x, y);
  // Registration at the foot of the way in.
  m.dec('regdesk', 27, 20);
  m.dec('signboard', 33, 20);
  m.dec('banner', 25, 20);
  m.dec('banner2', 36, 20);
  // The sports ground.
  m.room('Sports ground', 'play', 2, 25, 28, 8);
  m.dec('track', 3, 26, FLAT);
  m.dec('court', 19, 26, FLAT);
  m.dec('sofa', 20, 31);
  m.dec('sofa', 23, 31);
  m.dec('bin', 28, 25);
  // The garden party.
  m.room('Garden party', 'terrace', 34, 25, 25, 8);
  for (const x of [36, 40, 44, 48, 52]) m.dec('banquet', x, 27);
  for (const [x, y] of [[34, 31], [57, 31], [56, 25]]) m.dec('tree', x, y);
  for (const [x, y] of [[1, 21], [28, 21], [58, 22], [2, 33]]) m.dec('tree', x, y);
  m.lounge(30, 21);
});

// ---- Hackathon Hall: a big hall with a stage, workshop seating and team tables, and a team office down each side. ----
const hackathon = district({ key: 'hackathon', title: 'Hackathon Hall', w: 56, h: 32, fill: WOOD }, (m) => {
  m.walls(0, 0, 56, 32);
  m.gap(27, 0);
  m.gap(28, 0);
  m.rect(14, 1, 28, 30, FLOOR);
  m.room('Main hall', 'hall', 14, 1, 28, 30);
  m.dec('screen-wide', 26, 1, FLAT);
  m.dec('stage', 24, 2, FLAT);
  m.dec('lectern', 27, 3);
  m.dec('rug', 24, 7, FLAT);
  m.dec('banner', 16, 2);
  m.dec('banner2', 39, 2);
  for (const y of [10, 12, 14]) {
    for (let x = 17; x <= 22; x++) m.dec('seat', x, y);
    for (let x = 31; x <= 36; x++) m.dec('seat', x, y);
  }
  for (const [x, y] of [[20, 19], [26, 19], [32, 19], [20, 24], [26, 24], [32, 24]]) m.dec('banquet', x, y);
  m.dec('coffee', 15, 29);
  m.dec('coffee', 18, 29);
  m.dec('fridge', 38, 29);
  m.dec('plant', 15, 1);
  m.dec('plant', 40, 1);
  // Team offices: three down the left, three down the right. Each has a door onto the hall and a row of desks.
  const office = (name, x, y, doorX) => {
    m.walls(x, y, 12, 9);
    m.rect(x + 1, y + 1, 10, 7, CARPET);
    m.gap(doorX, y + 4);
    m.room(name, 'meeting', x + 1, y + 1, 10, 7);
    for (const dx of [2, 5, 8]) {
      m.dec('desk', x + dx, y + 2);
      m.dec('chair', x + dx, y + 3, { turn: 180 });
    }
    m.dec('cafe-table', x + 3, y + 6);
    m.dec('plant', x + 10, y + 7);
  };
  ['A', 'B', 'C'].forEach((n, i) => office(`Team ${n}`, 1, 1 + i * 10, 12));
  ['D', 'E', 'F'].forEach((n, i) => office(`Team ${n}`, 43, 1 + i * 10, 43));
  m.lounge(28, 16);
});

// ---- Job Fair: a reception, aisles of booths with banners, a recruiters' lounge and a talk stage with seats. ----
const jobfair = district({ key: 'jobfair', title: 'Job Fair', w: 44, h: 28, fill: FLOOR }, (m) => {
  m.walls(0, 0, 44, 28);
  m.gap(21, 0);
  m.gap(22, 0);
  m.room('Fair floor', 'hall', 1, 1, 42, 20);
  m.dec('regdesk', 19, 2);
  m.dec('signboard', 15, 2);
  m.dec('signboard', 25, 2);
  m.dec('banner', 12, 2);
  m.dec('banner2', 30, 2);
  const names = ['booth', 'booth2', 'booth3'];
  for (const y of [7, 13]) {
    for (let i = 0; i < 5; i++) {
      m.dec(names[(i + y) % 3], 3 + i * 3, y);
      m.dec(names[(i + y + 1) % 3], 25 + i * 3, y);
    }
  }
  for (const [x, y] of [[3, 4], [9, 4], [27, 4], [36, 4], [3, 16], [14, 16], [30, 16], [38, 16]]) m.dec(x % 2 ? 'banner' : 'banner2', x, y);
  m.dec('plant', 1, 20);
  m.dec('plant', 42, 20);
  // A talk stage with seats.
  m.room('Talk stage', 'meeting', 17, 21, 10, 6);
  m.dec('stage', 18, 21, FLAT);
  m.dec('lectern', 21, 22);
  for (let x = 18; x <= 25; x++) m.dec('seat', x, 25);
  // The recruiters' lounge.
  m.room('Recruiter lounge', 'lounge', 1, 22, 14, 5);
  m.rect(1, 22, 14, 5, WOOD);
  m.dec('rug', 3, 23, FLAT);
  m.dec('sofa', 2, 22);
  m.dec('sofa', 5, 22);
  m.dec('armchair', 9, 24);
  m.dec('coffee', 11, 22);
  m.dec('plant', 13, 26);
  m.dec('cafe-table', 29, 23);
  m.dec('cafe-table', 33, 23);
  m.dec('cafe-table', 37, 23);
  m.lounge(5, 25);
});

// ---- Meeting Centre: a reception and eight meeting rooms off a corridor. ----
const meeting = district({ key: 'meeting', title: 'Meeting Centre', w: 40, h: 24, fill: CARPET }, (m) => {
  m.walls(0, 0, 40, 24);
  m.gap(19, 0);
  m.gap(20, 0);
  m.rect(1, 9, 38, 5, FLOOR); // the corridor
  m.room('Reception', 'hall', 16, 1, 8, 8);
  m.dec('regdesk', 18, 3);
  m.dec('sofa', 17, 7);
  m.dec('plant', 16, 1);
  m.dec('plant', 23, 1);
  const room = (label, x, y, w, doorSide) => {
    m.walls(x, y, w, 8);
    m.rect(x + 1, y + 1, w - 2, 6, WOOD);
    m.gap(x + Math.floor(w / 2), doorSide === 'bottom' ? y + 7 : y);
    m.room(label, 'meeting', x + 1, y + 1, w - 2, 6);
    m.dec('screen-wide', x + 2, doorSide === 'bottom' ? y + 1 : y + 6, FLAT);
    m.dec('cafe-table', x + 1, doorSide === 'bottom' ? y + 3 : y + 2);
    m.dec('cafe-table', x + 4, doorSide === 'bottom' ? y + 3 : y + 2);
    m.dec('plant', x + w - 2, doorSide === 'bottom' ? y + 6 : y + 1);
  };
  const top = [[1, 8], [9, 7], [24, 7], [31, 8]];
  top.forEach(([x, w], i) => room(`Room ${i + 1}`, x, 1, w, 'bottom'));
  top.forEach(([x, w], i) => room(`Room ${i + 5}`, x, 15, w, 'top'));
  m.dec('sofa', 3, 11);
  m.dec('sofa', 30, 11);
  m.dec('coffee', 18, 11);
  m.dec('coffee', 21, 11);
  m.dec('fridge', 36, 10);
  m.lounge(12, 11);
});

/** In the order they stand along the second street, west to east. */
export const eventDistricts = [conference, hackathon, jobfair, meeting];
