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
};
/** These lie on the floor or hang on a wall, so you can walk over them. */
const FLAT = new Set(['rug', 'clock']);
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
