import type { OfficeMapJson, TiledLayer, TiledObject } from './index';

/**
 * Adding a department's room to the office (SPEC 3, 12). The map is a Tiled file, and this makes a new one with one more room on
 * it: nine tiles wide and ten high like the rooms in the top row, to the right of them, with four desks, a board and a meeting
 * table, a door onto the corridor, and the corridor carried on past it. The map grows by ten tiles each time, up to a fixed number
 * of rooms. Pure: it takes the map as data and gives back another; nothing is written here.
 */
const T = 32;
/** The first added room starts where the top row ends. */
const FIRST_X = 40;
const PITCH = 10;
export const MAX_ADDED_DEPARTMENTS = 8;

// Tile numbers in the starter tileset (scripts/make-office.mjs).
const FLOOR = 1;
const WALL = 2;
const CARPET = 3;
const DOOR = 6;
const DESK = 7;
const THING = 8;

export class PlotsFull extends Error {}
export class StampError extends Error {}

const KEY = /^[a-z0-9][a-z0-9-]*$/;
const prop = (name: string, type: string, value: unknown) => ({ name, type, value });

export function addDepartmentRoom(input: OfficeMapJson, dept: { key: string; name: string }): OfficeMapJson {
  const name = dept.name.trim();
  if (!name) throw new StampError('Give the department a name.');
  if (!KEY.test(dept.key)) throw new StampError(`The key "${dept.key}" is not a plain key: use lower-case letters, digits and dashes.`);

  const json = structuredClone(input);
  const layer = (n: string): TiledLayer => {
    const l = json.layers.find((x) => x.name === n);
    if (!l) throw new StampError(`The map has no layer called "${n}".`);
    return l;
  };
  const rooms = layer('rooms');
  const desks = layer('desks');
  const objects = layer('objects');
  const roomList = rooms.objects ?? [];
  if (roomList.some((r) => (r.name ?? '').toLowerCase() === name.toLowerCase())) throw new StampError(`There is already a room called "${name}".`);
  if (roomList.some((r) => r.properties?.some((p) => p.name === 'department' && p.value === dept.key))) throw new StampError(`The department "${dept.key}" already has a room.`);

  // Only department rooms count: the map is a town now, and the districts below also have rooms out to the right.
  const isDepartment = (r: TiledObject) => r.properties?.some((p) => p.name === 'kind' && p.value === 'department');
  const added = roomList.filter((r) => isDepartment(r) && r.x / T >= FIRST_X).length;
  if (added >= MAX_ADDED_DEPARTMENTS) throw new PlotsFull(`The office has no room for another department (${MAX_ADDED_DEPARTMENTS} can be added).`);
  const x0 = FIRST_X + PITCH * added;
  if (json.width < x0) throw new StampError(`The map is ${json.width} tiles wide, but the next room starts at ${x0}. It was changed by hand; add the room in Tiled.`);
  // The map grows only if the new room runs past its edge; in a town that is already wide it does not, and the room goes on the lawn.
  const newW = Math.max(json.width, x0 + PITCH);
  const H = json.height;

  // Lay the tiles out again at the new width. New ground is wall, and the room, its door and the corridor are carved out of it.
  for (const l of [layer('floor'), layer('collision')]) {
    const old = l.data ?? [];
    const solid = l.name === 'floor' ? WALL : 1;
    const data: number[] = Array(newW * H).fill(solid);
    for (let y = 0; y < H; y++) for (let x = 0; x < json.width; x++) data[y * newW + x] = old[y * json.width + x] ?? solid;
    l.data = data;
    l.width = newW;
  }
  const floor = layer('floor').data!;
  const coll = layer('collision').data!;
  const at = (x: number, y: number) => y * newW + x;
  const set = (x: number, y: number, tile: number) => {
    floor[at(x, y)] = tile;
    coll[at(x, y)] = tile === WALL ? 1 : 0;
  };
  // Brick round the room and its corridor, whatever was there before (new ground used to be wall; in a town it can be lawn).
  for (let x = x0 - 1; x <= x0 + PITCH - 1; x++) for (const y of [0, 11, 15]) set(x, y, WALL);
  for (let y = 0; y <= 15; y++) set(x0 + PITCH - 1, y, WALL);
  for (let y = 1; y <= 10; y++) for (let x = x0; x <= x0 + 8; x++) set(x, y, CARPET); // the room
  for (let y = 12; y <= 14; y++) for (let x = x0 - 1; x <= x0 + PITCH - 2; x++) set(x, y, FLOOR); // the corridor, carried on, through the old end wall
  set(x0 + 4, 11, DOOR); // the door onto the corridor
  json.width = newW;

  let id = Number(json.nextobjectid ?? 1);
  const obj = (n: string, type: string, x: number, y: number, size?: [number, number], properties?: ReturnType<typeof prop>[]): TiledObject & { rotation: number; visible: boolean } => ({
    id: id++,
    name: n,
    type,
    x: x * T,
    y: y * T,
    ...(size ? { width: size[0] * T, height: size[1] * T } : { point: true }),
    rotation: 0,
    visible: true,
    ...(properties ? { properties } : {}),
  });
  rooms.objects = [...roomList, obj(name, '', x0, 1, [9, 10], [prop('kind', 'string', 'department'), prop('department', 'string', dept.key)])];
  const seats: [number, number][] = [[2, 3], [5, 3], [2, 6], [5, 6]];
  desks.objects = [...(desks.objects ?? []), ...seats.map(([dx, dy], i) => obj(`${name} desk ${i + 1}`, '', x0 + dx, dy, undefined, [prop('room', 'string', name), prop('slot', 'int', i + 1)]))];
  for (const [dx, dy] of seats) set(x0 + dx, dy, DESK);
  const things: [string, string, number][] = [[`${name} board`, 'dept-board', 2], [`${name} table`, 'dept-table', 5]];
  objects.objects = [...(objects.objects ?? []), ...things.map(([n, type, dx]) => obj(n, type, x0 + dx, 8))];
  for (const [, , dx] of things) set(x0 + dx, 8, THING);
  json.nextobjectid = id + 1;
  return json;
}
