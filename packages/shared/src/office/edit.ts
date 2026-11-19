import { readOfficeMap, type OfficeMap, type OfficeMapJson, type TiledLayer, type TiledObject } from './index';

/**
 * Editing the office from inside it (S6B-9): put a piece of scenery down, or take one away. Pure: the map comes in and a changed copy
 * goes out. An edit is refused if it would not fit, stands on a wall, a door, a desk or another piece, or would cut a room, a desk or
 * the front door off from the way in. Desks are added with "Add a desk", not here.
 */
const T = 32;
const WALL = 2;

/** How many tiles each picture covers: [across, down]. The same table as scripts/lib/footprints.mjs (a test checks they agree). */
export const DECOR_FOOTPRINT: Readonly<Record<string, readonly [number, number]>> = {
  chair: [1, 1],
  desk: [1, 1],
  armchair: [1, 1],
  sofa: [2, 1],
  coffee: [2, 1],
  fridge: [1, 2],
  arcade: [1, 2],
  bookshelf: [2, 1],
  'cafe-table': [2, 1],
  pingpong: [3, 2],
  printer: [1, 1],
  bin: [1, 1],
  rug: [4, 3],
  plant: [1, 1],
  clock: [1, 1],
  tree: [2, 2],
  // Conferences, job fairs and sports (drawn in code by scripts/make-events-art.mjs).
  lectern: [1, 1],
  'screen-wide': [3, 1],
  booth: [2, 1],
  booth2: [2, 1],
  booth3: [2, 1],
  regdesk: [2, 1],
  banner: [1, 2],
  banner2: [1, 2],
  seat: [1, 1],
  banquet: [2, 2],
  signboard: [2, 1],
  stage: [8, 3],
  court: [8, 5],
  track: [12, 6],
};
/** These lie on the floor or hang on a wall, so you can walk over them. */
const FLAT = new Set(['rug', 'clock', 'stage', 'court', 'track']);
export class EditError extends Error {}

const layerOf = (json: OfficeMapJson, name: string): TiledLayer => {
  const l = json.layers.find((x) => x.name === name);
  if (!l) throw new EditError(`The map has no layer called "${name}".`);
  return l;
};

/** What can no longer be reached from the front door: a room, a desk or an entry, by name. */
function unreachable(m: OfficeMap): Set<string> {
  const out = new Set<string>();
  const door = m.entries.find((e) => e.name === 'door');
  if (!door) return out;
  // A flood fill over the open tiles from the door, to see what it can reach.
  const seen = new Set<number>([door.y * m.width + door.x]);
  const queue: [number, number][] = [[door.x, door.y]];
  for (let q = 0; q < queue.length; q++) {
    const [x, y] = queue[q]!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height || m.walls[ny]![nx] || seen.has(ny * m.width + nx)) continue;
      seen.add(ny * m.width + nx);
      queue.push([nx, ny]);
    }
  }
  const reach = (x: number, y: number) => seen.has(y * m.width + x);
  for (const r of m.rooms) {
    let any = false;
    for (let y = r.y; y < r.y + r.h && !any; y++) for (let x = r.x; x < r.x + r.w; x++) if (reach(x, y)) { any = true; break; }
    if (!any) out.add(r.name);
  }
  for (const d of m.desks) if (!reach(d.x, d.y)) out.add(`${d.room} desk ${d.slot}`);
  for (const e of m.entries) if (!reach(e.x, e.y)) out.add(e.name);
  return out;
}

export function placeDecor(input: OfficeMapJson, p: { name: string; x: number; y: number; turn?: number }, departments: { key: string; active: boolean }[]): OfficeMapJson {
  const foot = Object.hasOwn(DECOR_FOOTPRINT, p.name) ? DECOR_FOOTPRINT[p.name]! : null;
  if (!foot) throw new EditError(`There is no picture called "${p.name}".`);
  if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) throw new EditError('Say which tile, with whole numbers.');
  if (p.turn !== undefined && ![0, 90, 180, 270].includes(p.turn)) throw new EditError('A piece turns by 0, 90, 180 or 270 degrees.');
  const [w, h] = foot;
  if (p.x < 0 || p.y < 0 || p.x + w > input.width || p.y + h > input.height) throw new EditError('That does not fit on the map.');

  const file = 'office.tmj';
  const before = readOfficeMap(input, { file, departments });
  const json = structuredClone(input);
  const floor = layerOf(json, 'floor').data!;
  const coll = layerOf(json, 'collision').data!;
  const solid = !FLAT.has(p.name);
  for (let y = p.y; y < p.y + h; y++)
    for (let x = p.x; x < p.x + w; x++) {
      const i = y * json.width + x;
      if (floor[i] === WALL) throw new EditError('A wall is in the way.');
      if (before.entries.some((e) => e.x === x && e.y === y)) throw new EditError('An entry (the door or a marked spot) is there.');
      if (before.desks.some((d) => d.x === x && d.y === y)) throw new EditError('A desk is there.');
      if (solid && coll[i] !== 0) throw new EditError('Something else is in the way.');
    }
  const decor = layerOf(json, 'decor');
  const id = Number(json.nextobjectid ?? 1);
  const o: TiledObject & { rotation: number; visible: boolean } = {
    id,
    name: p.name,
    type: 'decor',
    x: p.x * T,
    y: p.y * T,
    width: w * T,
    height: h * T,
    rotation: 0,
    visible: true,
    ...(p.turn ? { properties: [{ name: 'turn', type: 'int', value: p.turn }] } : {}),
  };
  decor.objects = [...(decor.objects ?? []), o];
  json.nextobjectid = id + 1;
  if (solid) for (let y = p.y; y < p.y + h; y++) for (let x = p.x; x < p.x + w; x++) coll[y * json.width + x] = 1;

  // It must still read, and it must not cut anything off that could be reached before.
  const after = readOfficeMap(json, { file, departments });
  const was = unreachable(before);
  for (const name of unreachable(after)) if (!was.has(name)) throw new EditError(`That would block the way to ${name}.`);
  return json;
}

export function removeDecor(input: OfficeMapJson, id: number): OfficeMapJson {
  const json = structuredClone(input);
  const decor = layerOf(json, 'decor');
  const at = (decor.objects ?? []).findIndex((o) => o.id === id);
  if (at < 0) throw new EditError('There is no scenery with that number. (Desks are added with "Add a desk".)');
  const [gone] = decor.objects!.splice(at, 1);
  if (!FLAT.has(gone!.name ?? '')) {
    const floor = layerOf(json, 'floor').data!;
    const coll = layerOf(json, 'collision').data!;
    const x0 = gone!.x / T;
    const y0 = gone!.y / T;
    for (let y = y0; y < y0 + (gone!.height ?? T) / T; y++)
      for (let x = x0; x < x0 + (gone!.width ?? T) / T; x++) if (floor[y * json.width + x] !== WALL) coll[y * json.width + x] = 0;
  }
  return json;
}

/**
 * Moves a piece to another tile (S6C-2): taken up and put down in one change, keeping its turn. Nothing changes if the new place is
 * refused, and it can slide onto part of the tiles it stood on.
 */
export function moveDecor(input: OfficeMapJson, id: number, to: { x: number; y: number }, departments: { key: string; active: boolean }[]): OfficeMapJson {
  const piece = (layerOf(input, 'decor').objects ?? []).find((o) => o.id === id);
  if (!piece) throw new EditError('There is no scenery with that number. (Desks are added with "Add a desk".)');
  const turn = Number(piece.properties?.find((p) => p.name === 'turn')?.value ?? 0);
  return placeDecor(removeDecor(input, id), { name: piece.name ?? '', ...to, ...(turn ? { turn } : {}) }, departments);
}

/**
 * Opens or closes a door (S6C-2): a gap in a wall that is one tile thick. Opening takes a wall tile with open floor on its two opposite sides
 * and turns it into floor; closing takes such a gap and turns it back into wall. A door is never put on a map edge, on a thick wall or a
 * corner, on a piece of scenery, a desk or an entry, and closing one is refused if it would cut a room, a desk or the front door off from the
 * way in. Nothing changes if it is refused.
 */
export function setDoor(input: OfficeMapJson, p: { x: number; y: number; open: boolean }, departments: { key: string; active: boolean }[]): OfficeMapJson {
  if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) throw new EditError('Say which tile, with whole numbers.');
  if (p.x < 1 || p.y < 1 || p.x >= input.width - 1 || p.y >= input.height - 1) throw new EditError('A door cannot go on the edge of the map.');
  const file = 'office.tmj';
  const json = structuredClone(input);
  const floor = layerOf(json, 'floor').data!;
  const coll = layerOf(json, 'collision').data!;
  const W = json.width;
  const at = (x: number, y: number) => y * W + x;
  const isWall = (x: number, y: number) => floor[at(x, y)] === WALL;
  const i = at(p.x, p.y);
  const across = !isWall(p.x - 1, p.y) && !isWall(p.x + 1, p.y);
  const down = !isWall(p.x, p.y - 1) && !isWall(p.x, p.y + 1);
  if (p.open) {
    if (!isWall(p.x, p.y)) throw new EditError('That is not a wall, so there is nothing to open.');
    if (!across && !down) throw new EditError('A door goes in a wall one tile thick, with floor on both sides.');
    floor[i] = across ? floor[at(p.x - 1, p.y)]! : floor[at(p.x, p.y - 1)]!;
    coll[i] = 0;
    return json;
  }
  if (isWall(p.x, p.y)) throw new EditError('That is already a wall.');
  // A gap has wall on two opposite sides and open floor on the other two.
  const gapAcross = isWall(p.x - 1, p.y) && isWall(p.x + 1, p.y) && !isWall(p.x, p.y - 1) && !isWall(p.x, p.y + 1);
  const gapDown = isWall(p.x, p.y - 1) && isWall(p.x, p.y + 1) && !isWall(p.x - 1, p.y) && !isWall(p.x + 1, p.y);
  if (!gapAcross && !gapDown) throw new EditError('That is not a gap in a wall, so there is nothing to close.');
  const before = readOfficeMap(input, { file, departments }); // read only once the tile is known to be a gap: reading the whole map is the slow part
  if (before.entries.some((e) => e.x === p.x && e.y === p.y)) throw new EditError('An entry (the door or a marked spot) is there.');
  if (before.desks.some((d) => d.x === p.x && d.y === p.y)) throw new EditError('A desk is there.');
  for (const o of layerOf(json, 'decor').objects ?? []) {
    const x0 = o.x / T;
    const y0 = o.y / T;
    if (p.x >= x0 && p.x < x0 + (o.width ?? T) / T && p.y >= y0 && p.y < y0 + (o.height ?? T) / T) throw new EditError('Scenery is there.');
  }
  floor[i] = WALL;
  coll[i] = 1;
  const after = readOfficeMap(json, { file, departments });
  const was = unreachable(before);
  for (const name of unreachable(after)) if (!was.has(name)) throw new EditError(`That would block the way to ${name}.`);
  return json;
}

export type Side = 'north' | 'south' | 'east' | 'west';
export const SIDES: readonly Side[] = ['north', 'south', 'east', 'west'];

/**
 * Makes a room one tile bigger on one side (S6C-2): its wall on that side moves out by a tile, taking its doorways with it, and the tile the
 * wall stood on becomes floor like the rest of the room. It is refused if the tile beyond is a wall, another room (a terrace is outdoors, so
 * it does not count), a piece of scenery, a desk or an entry, if it would go off the map, or if it would cut anything off from the way in.
 * Nothing changes if it is refused.
 */
export function growRoom(input: OfficeMapJson, p: { room: string; side: string }, departments: { key: string; active: boolean }[]): OfficeMapJson {
  if (!(SIDES as readonly string[]).includes(p.side)) throw new EditError('A room grows to the north, south, east or west.');
  const side = p.side as Side;
  const file = 'office.tmj';
  const before = readOfficeMap(input, { file, departments });
  const r = before.rooms.find((x) => x.name === p.room);
  if (!r) throw new EditError(`There is no room called "${p.room}".`);
  const json = structuredClone(input);
  const floor = layerOf(json, 'floor').data!;
  const coll = layerOf(json, 'collision').data!;
  const W = json.width;
  const len = side === 'east' || side === 'west' ? r.h : r.w;
  // Along the wall: -1 and len are its two corners, 0..len-1 the tiles in between.
  const spots = (i: number) =>
    side === 'east' ? { old: [r.x + r.w, r.y + i], neu: [r.x + r.w + 1, r.y + i], inner: [r.x + r.w - 1, r.y + i] }
    : side === 'west' ? { old: [r.x - 1, r.y + i], neu: [r.x - 2, r.y + i], inner: [r.x, r.y + i] }
    : side === 'south' ? { old: [r.x + i, r.y + r.h], neu: [r.x + i, r.y + r.h + 1], inner: [r.x + i, r.y + r.h - 1] }
    : { old: [r.x + i, r.y - 1], neu: [r.x + i, r.y - 2], inner: [r.x + i, r.y] };
  const decor = layerOf(json, 'decor').objects ?? [];
  const objects = (json.layers.find((l) => l.name === 'objects')?.objects ?? []);
  const covers = (o: TiledObject, x: number, y: number) => x >= o.x / T && x < (o.x + (o.width ?? T)) / T && y >= o.y / T && y < (o.y + (o.height ?? T)) / T;
  const plan: { old: number; neu: number; inner: number; corner: boolean }[] = [];
  for (let i = -1; i <= len; i++) {
    const s = spots(i);
    const [nx, ny] = s.neu as [number, number];
    if (nx < 0 || ny < 0 || nx >= W || ny >= json.height) throw new EditError('That would go off the map.');
    const corner = i === -1 || i === len;
    const ni = ny * W + nx;
    if (!corner || floor[ni] !== WALL) {
      // Beyond the wall, the tile must be free: open ground that no other room, piece, desk or entry is using.
      if (floor[ni] === WALL) throw new EditError('A wall is in the way.');
      const other = before.rooms.find((o) => o.name !== r.name && o.kind !== 'terrace' && nx >= o.x - 1 && nx <= o.x + o.w && ny >= o.y - 1 && ny <= o.y + o.h);
      if (other) throw new EditError(`${other.name} is in the way.`);
      if (decor.some((o) => covers(o, nx, ny)) || objects.some((o) => covers(o, nx, ny))) throw new EditError('A piece of scenery is in the way.');
      if (before.desks.some((d) => d.x === nx && d.y === ny)) throw new EditError('A desk is in the way.');
      if (before.entries.some((e) => e.x === nx && e.y === ny)) throw new EditError('An entry is in the way.');
    }
    const [ox, oy] = s.old as [number, number];
    const [ix, iy] = s.inner as [number, number];
    plan.push({ old: oy * W + ox, neu: ni, inner: iy * W + ix, corner });
  }
  for (const t of plan) {
    const wallValue = floor[t.old]!;
    const wallColl = coll[t.old]!;
    floor[t.neu] = wallValue;
    coll[t.neu] = wallColl;
    if (!t.corner) {
      floor[t.old] = floor[t.inner]!;
      coll[t.old] = 0;
    }
  }
  const o = (layerOf(json, 'rooms').objects ?? []).find((x) => x.name === r.name);
  if (!o) throw new EditError('That room is not in the map file.');
  if (side === 'east') o.width = (o.width ?? 0) + T;
  else if (side === 'south') o.height = (o.height ?? 0) + T;
  else if (side === 'west') {
    o.x -= T;
    o.width = (o.width ?? 0) + T;
  } else {
    o.y -= T;
    o.height = (o.height ?? 0) + T;
  }
  const after = readOfficeMap(json, { file, departments });
  const was = unreachable(before);
  for (const name of unreachable(after)) if (!was.has(name)) throw new EditError(`That would block the way to ${name}.`);
  return json;
}

/**
 * Makes a room one tile smaller on one side (S6C-2): the reverse of `growRoom`. Its wall on that side moves in by a tile, taking its
 * doorways, and the tile the wall stood on becomes open ground like what lies beyond it. Refused if the room would get too small (under
 * two tiles across), if scenery, a desk or an entry stands on the tile that would become wall, if another room shares that wall, or if it
 * would cut anything off. The two corners stay as they are. Nothing changes if it is refused.
 */
export function shrinkRoom(input: OfficeMapJson, p: { room: string; side: string }, departments: { key: string; active: boolean }[]): OfficeMapJson {
  if (!(SIDES as readonly string[]).includes(p.side)) throw new EditError('A room shrinks from the north, south, east or west.');
  const side = p.side as Side;
  const file = 'office.tmj';
  const before = readOfficeMap(input, { file, departments });
  const r = before.rooms.find((x) => x.name === p.room);
  if (!r) throw new EditError(`There is no room called "${p.room}".`);
  const across = side === 'east' || side === 'west' ? r.w : r.h;
  if (across <= 2) throw new EditError('That room is too small to shrink any more.');
  const json = structuredClone(input);
  const floor = layerOf(json, 'floor').data!;
  const coll = layerOf(json, 'collision').data!;
  const W = json.width;
  const len = side === 'east' || side === 'west' ? r.h : r.w;
  const spot = (i: number) =>
    side === 'east' ? { old: [r.x + r.w, r.y + i], inner: [r.x + r.w - 1, r.y + i], beyond: [r.x + r.w + 1, r.y + i] }
    : side === 'west' ? { old: [r.x - 1, r.y + i], inner: [r.x, r.y + i], beyond: [r.x - 2, r.y + i] }
    : side === 'south' ? { old: [r.x + i, r.y + r.h], inner: [r.x + i, r.y + r.h - 1], beyond: [r.x + i, r.y + r.h + 1] }
    : { old: [r.x + i, r.y - 1], inner: [r.x + i, r.y], beyond: [r.x + i, r.y - 2] };
  const decor = layerOf(json, 'decor').objects ?? [];
  const objects = json.layers.find((l) => l.name === 'objects')?.objects ?? [];
  const covers = (o: TiledObject, x: number, y: number) => x >= o.x / T && x < (o.x + (o.width ?? T)) / T && y >= o.y / T && y < (o.y + (o.height ?? T)) / T;
  const plan: { old: number; inner: number; beyond: number }[] = [];
  for (let i = 0; i < len; i++) {
    const s = spot(i);
    const [ix, iy] = s.inner as [number, number];
    const [bx, by] = s.beyond as [number, number];
    const [ox, oy] = s.old as [number, number];
    if (bx < 0 || by < 0 || bx >= W || by >= json.height) throw new EditError('That would go off the map.');
    if (decor.some((o) => covers(o, ix, iy)) || objects.some((o) => covers(o, ix, iy))) throw new EditError('A piece of scenery is in the way.');
    if (before.desks.some((d) => d.x === ix && d.y === iy)) throw new EditError('A desk is in the way.');
    if (before.entries.some((e) => e.x === ix && e.y === iy)) throw new EditError('An entry is in the way.');
    const shared = before.rooms.find((o) => o.name !== r.name && o.kind !== 'terrace' && bx >= o.x - 1 && bx <= o.x + o.w && by >= o.y - 1 && by <= o.y + o.h);
    if (shared) throw new EditError(`${shared.name} shares that wall.`);
    if (floor[by * W + bx] === WALL) throw new EditError('Another wall is right behind it.');
    plan.push({ old: oy * W + ox, inner: iy * W + ix, beyond: by * W + bx });
  }
  // A corner tile at the end of the wall (nothing of a shared wall behind it) goes back to open ground, so a grow can be undone exactly.
  const corners: { old: number; beyond: number }[] = [];
  for (const i of [-1, len]) {
    const s = spot(i);
    const [ox, oy] = s.old as [number, number];
    const [bx, by] = s.beyond as [number, number];
    if (bx < 0 || by < 0 || bx >= W || by >= json.height) continue;
    if (floor[oy * W + ox] === WALL && floor[by * W + bx] !== WALL) corners.push({ old: oy * W + ox, beyond: by * W + bx });
  }
  for (const c of corners) {
    floor[c.old] = floor[c.beyond]!;
    coll[c.old] = coll[c.beyond]!;
  }
  for (const t of plan) {
    floor[t.inner] = floor[t.old]!;
    coll[t.inner] = coll[t.old]!;
    floor[t.old] = floor[t.beyond]!;
    coll[t.old] = coll[t.beyond]!;
  }
  const o = (layerOf(json, 'rooms').objects ?? []).find((x) => x.name === r.name);
  if (!o) throw new EditError('That room is not in the map file.');
  if (side === 'east') o.width = (o.width ?? 0) - T;
  else if (side === 'south') o.height = (o.height ?? 0) - T;
  else if (side === 'west') {
    o.x += T;
    o.width = (o.width ?? 0) - T;
  } else {
    o.y += T;
    o.height = (o.height ?? 0) - T;
  }
  const after = readOfficeMap(json, { file, departments });
  const was = unreachable(before);
  for (const name of unreachable(after)) if (!was.has(name)) throw new EditError(`That would block the way to ${name}.`);
  return json;
}
