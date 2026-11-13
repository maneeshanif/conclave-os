/**
 * The office map (SPEC 12). The office is a Tiled JSON map: tile layers for how it looks and where the walls are, and object
 * layers for rooms, desks, things you can use and places you arrive. This reads it into plain facts and refuses a mistake with the
 * file, the layer and the object named. The property names are our own. Nothing here draws anything.
 */
export const TILE_SIZE = 32;
export const OBJECT_TYPES = ['approvals-desk', 'whiteboard', 'screen', 'mailbox', 'jobboard', 'boardroom-table'] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];
export const ROOM_KINDS = ['department', 'boardroom', 'lounge', 'hall', 'meeting'] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

export interface TiledProperty {
  name: string;
  type?: string;
  value: unknown;
}
export interface TiledObject {
  id?: number;
  name?: string;
  type?: string;
  class?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  point?: boolean;
  properties?: TiledProperty[];
}
export interface TiledLayer {
  id?: number;
  name: string;
  type: string;
  width?: number;
  height?: number;
  data?: number[];
  objects?: TiledObject[];
}
export interface OfficeMapJson {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  [key: string]: unknown;
}

export interface Room {
  name: string;
  kind: RoomKind;
  /** The department key this room belongs to; null for the Boardroom, the lounge and halls. */
  department: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  maxUsers: number | null;
  locked: boolean;
  silent: boolean;
  focusable: boolean;
}
export interface Desk {
  room: string;
  slot: number;
  x: number;
  y: number;
}
export interface OfficeObject {
  type: ObjectType;
  name: string;
  x: number;
  y: number;
}
export interface Entry {
  name: string;
  x: number;
  y: number;
}
export interface OfficeMap {
  width: number;
  height: number;
  tile: number;
  /** true where you cannot walk. Indexed [y][x]. */
  walls: boolean[][];
  rooms: Room[];
  desks: Desk[];
  objects: OfficeObject[];
  entries: Entry[];
}

export class OfficeMapError extends Error {}

const ROOM_PROPS = new Set(['department', 'kind', 'maxUsers', 'locked', 'silent', 'focusable']);

export function readOfficeMap(json: unknown, o: { file: string; departments: { key: string; active: boolean }[] }): OfficeMap {
  const fail = (where: string, why: string): never => {
    throw new OfficeMapError(`${o.file}${where ? `: ${where}` : ''}: ${why}`);
  };
  if (!json || typeof json !== 'object' || !Array.isArray((json as OfficeMapJson).layers)) return fail('', 'this is not a Tiled map (no layers)');
  const m = json as OfficeMapJson;
  if (!Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width < 1 || m.height < 1) return fail('', 'the map needs a whole-number width and height');
  if (m.tilewidth !== TILE_SIZE || m.tileheight !== TILE_SIZE) return fail('', `tiles must be ${TILE_SIZE} by ${TILE_SIZE}`);

  const layer = (name: string, type: 'tilelayer' | 'objectgroup'): TiledLayer => {
    const l = m.layers.find((x) => x.name === name);
    if (!l) return fail(`layer "${name}"`, `missing. The map needs a ${type === 'tilelayer' ? 'tile' : 'object'} layer called "${name}"`);
    if (l.type !== type) return fail(`layer "${name}"`, `must be a ${type}`);
    return l;
  };
  const floor = layer('floor', 'tilelayer');
  const collision = layer('collision', 'tilelayer');
  for (const l of [floor, collision]) if (!Array.isArray(l.data) || l.data.length !== m.width * m.height) fail(`layer "${l.name}"`, `must have ${m.width * m.height} tiles (the map's size), not ${l.data?.length ?? 0}`);
  const walls: boolean[][] = Array.from({ length: m.height }, (_, y) => Array.from({ length: m.width }, (_, x) => (collision.data![y * m.width + x] ?? 0) !== 0));

  const prop = (obj: TiledObject, name: string): unknown => obj.properties?.find((p) => p.name === name)?.value;
  const tileOf = (v: number) => Math.floor(v / TILE_SIZE);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < m.width && y < m.height;

  // Rooms.
  const rooms: Room[] = [];
  for (const r of layer('rooms', 'objectgroup').objects ?? []) {
    const where = `layer "rooms", object "${r.name ?? r.id}"`;
    if (!r.name) fail(where, 'every room needs a name');
    if (rooms.some((x) => x.name === r.name)) fail(where, 'two rooms have this name; a name may be used only once');
    for (const p of r.properties ?? []) if (!ROOM_PROPS.has(p.name)) fail(where, `unknown property "${p.name}". Rooms may have: ${[...ROOM_PROPS].join(', ')}`);
    const kind = String(prop(r, 'kind') ?? 'department');
    if (!(ROOM_KINDS as readonly string[]).includes(kind)) fail(where, `unknown kind "${kind}". Use one of: ${ROOM_KINDS.join(', ')}`);
    const department = prop(r, 'department');
    if (kind === 'department') {
      if (typeof department !== 'string' || !department) fail(where, 'a department room needs a "department" property');
      if (!o.departments.some((d) => d.key === department)) fail(where, `the department "${String(department)}" is not in departments.yaml`);
    }
    const w = tileOf(r.width ?? 0);
    const h = tileOf(r.height ?? 0);
    if (w < 1 || h < 1) fail(where, 'a room must be a rectangle at least one tile wide and high');
    const x = tileOf(r.x);
    const y = tileOf(r.y);
    if (!inside(x, y) || !inside(x + w - 1, y + h - 1)) fail(where, 'the room runs off the map');
    const max = prop(r, 'maxUsers');
    if (max !== undefined && (!Number.isInteger(max) || (max as number) < 1)) fail(where, 'maxUsers must be a whole number of at least 1');
    rooms.push({
      name: r.name!,
      kind: kind as RoomKind,
      department: kind === 'department' ? (department as string) : null,
      x,
      y,
      w,
      h,
      maxUsers: typeof max === 'number' ? max : null,
      locked: prop(r, 'locked') === true,
      silent: prop(r, 'silent') === true,
      focusable: prop(r, 'focusable') === true,
    });
  }
  const missing = o.departments.filter((d) => d.active && !rooms.some((r) => r.department === d.key)).map((d) => d.key);
  if (missing.length) fail('layer "rooms"', `no room for the active department${missing.length > 1 ? 's' : ''} ${missing.join(', ')}. Draw one in Tiled and give it a "department" property`);

  // Desks.
  const desks: Desk[] = [];
  for (const d of layer('desks', 'objectgroup').objects ?? []) {
    const where = `layer "desks", object "${d.name ?? d.id}"`;
    const room = prop(d, 'room');
    const slot = prop(d, 'slot');
    const r = rooms.find((x) => x.name === room);
    if (!r) fail(where, `the room "${String(room)}" does not exist`);
    if (!Number.isInteger(slot) || (slot as number) < 1) fail(where, 'slot must be a whole number from 1');
    const x = tileOf(d.x);
    const y = tileOf(d.y);
    if (!inside(x, y) || walls[y]![x]) fail(where, 'this desk is on a wall or off the map');
    if (!(x >= r!.x && x < r!.x + r!.w && y >= r!.y && y < r!.y + r!.h)) fail(where, `this desk is outside its room "${r!.name}"`);
    if (desks.some((e) => e.room === r!.name && e.slot === slot)) fail(where, `slot ${String(slot)} is used twice in "${r!.name}"; each desk needs its own number`);
    desks.push({ room: r!.name, slot: slot as number, x, y });
  }

  // Objects.
  const objects: OfficeObject[] = [];
  for (const b of layer('objects', 'objectgroup').objects ?? []) {
    const where = `layer "objects", object "${b.name ?? b.id}"`;
    const type = b.type || b.class || '';
    if (!(OBJECT_TYPES as readonly string[]).includes(type)) fail(where, `unknown type "${type}". Use one of: ${OBJECT_TYPES.join(', ')}`);
    if (!b.name) fail(where, 'every object needs a name');
    if (objects.some((e) => e.name === b.name)) fail(where, 'two objects have this name (a duplicate); a name may be used only once');
    const x = tileOf(b.x);
    const y = tileOf(b.y);
    if (!inside(x, y) || walls[y]![x]) fail(where, 'this object is on a wall or off the map');
    objects.push({ type: type as ObjectType, name: b.name!, x, y });
  }

  // Places you arrive.
  const entries: Entry[] = [];
  for (const e of layer('entries', 'objectgroup').objects ?? []) {
    const where = `layer "entries", object "${e.name ?? e.id}"`;
    const x = tileOf(e.x);
    const y = tileOf(e.y);
    if (!e.name) fail(where, 'every entry needs a name');
    if (!inside(x, y) || walls[y]![x]) fail(where, 'this entry is on a wall or off the map');
    entries.push({ name: e.name!, x, y });
  }
  if (!entries.some((e) => e.name === 'door')) fail('layer "entries"', 'there must be an entry called "door", where you arrive');

  return { width: m.width, height: m.height, tile: TILE_SIZE, walls, rooms, desks, objects, entries };
}
export * from './places';
