import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OBJECT_TYPES, OfficeMapError, readOfficeMap, type OfficeMapJson } from '../src/office';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const raw = (): OfficeMapJson => JSON.parse(readFileSync(path.join(root, 'company', 'office.tmj'), 'utf8')) as OfficeMapJson;
/** The departments file, read with a pattern: this package has no YAML reader, and the file is one flow-style line per department. */
const departments = readFileSync(path.join(root, 'company', 'departments.yaml'), 'utf8')
  .split(/\r?\n/)
  .flatMap((l) => {
    const m = /\{\s*key:\s*([a-z0-9-]+),.*active:\s*(true|false)/.exec(l);
    return m ? [{ key: m[1]!, active: m[2] === 'true' }] : [];
  });
const read = (j: unknown = raw(), deps = departments) => readOfficeMap(j, { file: 'company/office.tmj', departments: deps });
/** A deep copy to break on purpose. */
const copy = () => JSON.parse(JSON.stringify(raw())) as OfficeMapJson;
const layer = (j: OfficeMapJson, name: string) => j.layers.find((l) => l.name === name)!;
const msg = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(OfficeMapError);
    return (e as Error).message;
  }
  throw new Error('expected the map to be refused');
};

describe('the starter office map (S6-1)', () => {
  it('loads, and is the size the file says', () => {
    const m = read();
    expect(m.width).toBe(raw().width);
    expect(m.height).toBe(raw().height);
    expect(m.tile).toBe(32);
    expect(m.walls).toHaveLength(m.height);
    expect(m.walls[0]).toHaveLength(m.width);
  });

  it('has a room for every active department, a Boardroom and a lounge, and knows which is which', () => {
    const m = read();
    for (const d of departments.filter((x) => x.active)) expect(m.rooms.find((r) => r.department === d.key), d.key).toBeTruthy();
    expect(m.rooms.filter((r) => r.kind === 'boardroom')).toHaveLength(1);
    expect(m.rooms.filter((r) => r.kind === 'lounge')).toHaveLength(1);
    expect(m.rooms.find((r) => r.department === 'outreach')).toMatchObject({ kind: 'department', locked: false });
  });

  it('numbers the desks 1, 2, 3 in each department room, each inside its room and off the walls', () => {
    const m = read();
    for (const r of m.rooms.filter((x) => x.kind === 'department')) {
      const slots = m.desks.filter((d) => d.room === r.name).map((d) => d.slot).sort((a, b) => a - b);
      expect(slots.length, r.name).toBeGreaterThanOrEqual(3);
      expect(slots, r.name).toEqual(slots.map((_, i) => i + 1));
    }
    for (const d of m.desks) {
      const r = m.rooms.find((x) => x.name === d.room)!;
      expect(d.x >= r.x && d.x < r.x + r.w && d.y >= r.y && d.y < r.y + r.h).toBe(true);
      expect(m.walls[d.y]![d.x]).toBe(false);
    }
  });

  it('has every kind of object the office needs, each on open floor with a name', () => {
    const m = read();
    for (const t of ['approvals-desk', 'whiteboard', 'screen', 'mailbox', 'jobboard', 'boardroom-table'] as const) expect(m.objects.filter((o) => o.type === t), t).toHaveLength(1);
    expect(OBJECT_TYPES).toEqual(expect.arrayContaining(['approvals-desk', 'whiteboard', 'screen', 'mailbox', 'jobboard', 'boardroom-table']));
    for (const o of m.objects) expect(m.walls[o.y]![o.x], o.name).toBe(false);
  });

  it('has a door to arrive by, on open floor', () => {
    const m = read();
    const door = m.entries.find((e) => e.name === 'door')!;
    expect(door).toBeTruthy();
    expect(m.walls[door.y]![door.x]).toBe(false);
  });

  it('puts the approvals desk by the door', () => {
    const m = read();
    const door = m.entries.find((e) => e.name === 'door')!;
    const desk = m.objects.find((o) => o.type === 'approvals-desk')!;
    expect(Math.abs(desk.x - door.x) + Math.abs(desk.y - door.y)).toBeLessThanOrEqual(6);
  });
});

describe('a map with a mistake is refused, saying where (S6-1)', () => {
  it('a department that does not exist', () => {
    const j = copy();
    (layer(j, 'rooms').objects![0]!.properties!.find((p) => p.name === 'department')!).value = 'no-such-dept';
    expect(msg(() => read(j))).toMatch(/company\/office\.tmj.*rooms.*no-such-dept/s);
  });

  it('an active department with no room', () => {
    expect(msg(() => read(raw(), [...departments, { key: 'brand-new', active: true }]))).toMatch(/no room.*brand-new/is);
    expect(() => read(raw(), [...departments, { key: 'brand-new', active: false }])).not.toThrow(); // an inactive one may wait for its room
  });

  it('a desk number twice in one room', () => {
    const j = copy();
    const desks = layer(j, 'desks').objects!;
    const first = desks[0]!;
    const same = desks.find((d) => d !== first && d.properties!.find((p) => p.name === 'room')!.value === first.properties!.find((p) => p.name === 'room')!.value)!;
    same.properties!.find((p) => p.name === 'slot')!.value = first.properties!.find((p) => p.name === 'slot')!.value;
    expect(msg(() => read(j))).toMatch(/desks.*slot.*twice|desks.*duplicate/is);
  });

  it('a desk on a wall, or outside its room', () => {
    const j = copy();
    const d = layer(j, 'desks').objects![0]!;
    d.x = 0;
    d.y = 0;
    expect(msg(() => read(j))).toMatch(/desks.*(wall|outside)/is);
  });

  it('an object of a type it does not know, and a name used twice', () => {
    const j = copy();
    layer(j, 'objects').objects![0]!.type = 'teleporter';
    expect(msg(() => read(j))).toMatch(/objects.*teleporter/is);
    const k = copy();
    const objs = layer(k, 'objects').objects!;
    objs[1]!.name = objs[0]!.name;
    expect(msg(() => read(k))).toMatch(/objects.*(twice|duplicate)/is);
  });

  it('a missing collision layer, and one of the wrong size', () => {
    const j = copy();
    j.layers = j.layers.filter((l) => l.name !== 'collision');
    expect(msg(() => read(j))).toMatch(/collision/i);
    const k = copy();
    layer(k, 'collision').data = [1, 0, 1];
    expect(msg(() => read(k))).toMatch(/collision.*(size|tiles)/is);
  });

  it('a room property it does not know, a kind it does not know, and no door', () => {
    const j = copy();
    layer(j, 'rooms').objects![0]!.properties!.push({ name: 'teleports', type: 'bool', value: true });
    expect(msg(() => read(j))).toMatch(/rooms.*teleports/is);
    const k = copy();
    layer(k, 'rooms').objects![0]!.properties!.find((p) => p.name === 'kind')!.value = 'dungeon';
    expect(msg(() => read(k))).toMatch(/rooms.*dungeon/is);
    const n = copy();
    layer(n, 'entries').objects = layer(n, 'entries').objects!.filter((e) => e.name !== 'door');
    expect(msg(() => read(n))).toMatch(/entries.*door/is);
  });

  it('a file that is not a Tiled map at all', () => {
    expect(msg(() => read('nonsense'))).toMatch(/company\/office\.tmj.*not a Tiled map/is);
    expect(msg(() => read({ layers: [] }))).toMatch(/width|height/i);
  });
});
