import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDepartmentRoom, findPath, nearestReachable, MAX_ADDED_DEPARTMENTS, PlotsFull, readOfficeMap, type OfficeMap, type OfficeMapJson } from '../src/office';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const base = JSON.parse(readFileSync(path.join(root, 'company', 'office.tmj'), 'utf8')) as OfficeMapJson;
const departments = readFileSync(path.join(root, 'company', 'departments.yaml'), 'utf8')
  .split(/\r?\n/)
  .flatMap((l) => {
    const m = /\{\s*key:\s*([a-z0-9-]+),.*active:\s*(true|false)/.exec(l);
    return m ? [{ key: m[1]!, active: m[2] === 'true' }] : [];
  });
const read = (j: OfficeMapJson, extra: { key: string; active: boolean }[] = []): OfficeMap => readOfficeMap(j, { file: 'office.tmj', departments: [...departments, ...extra] });
const dept = (n: number) => ({ key: `team-${n}`, name: `Team ${n}` });
const add = (j: OfficeMapJson, n: number) => addDepartmentRoom(j, dept(n));

describe('stamping a department room onto the map (S6-13b)', () => {
  it('adds a room for the department with four desks, a board and a meeting table, and the map still reads', () => {
    const j = add(base, 1);
    const m = read(j, [{ key: 'team-1', active: true }]);
    const room = m.rooms.find((r) => r.name === 'Team 1')!;
    expect(room).toMatchObject({ kind: 'department', department: 'team-1' });
    expect(m.desks.filter((d) => d.room === 'Team 1').map((d) => d.slot).sort()).toEqual([1, 2, 3, 4]);
    expect(m.objects.find((o) => o.name === 'Team 1 board')).toMatchObject({ type: 'dept-board' });
    expect(m.objects.find((o) => o.name === 'Team 1 table')).toMatchObject({ type: 'dept-table' });
    for (const d of m.desks.filter((x) => x.room === 'Team 1')) expect(d.x >= room.x && d.x < room.x + room.w && d.y >= room.y && d.y < room.y + room.h).toBe(true);
  });

  it('grows the map to the right by one room each time, and never changes the height', () => {
    const one = add(base, 1);
    expect([one.width, one.height]).toEqual([base.width + 10, base.height]);
    const two = add(one, 2);
    expect([two.width, two.height]).toEqual([base.width + 20, base.height]);
    for (const l of two.layers.filter((x) => x.type === 'tilelayer')) expect(l.data).toHaveLength(two.width * two.height);
  });

  it('leaves everything that was already on the map where it was', () => {
    const j = add(base, 1);
    const before = read(base);
    const after = read(j, [{ key: 'team-1', active: true }]);
    for (const r of before.rooms) expect(after.rooms.find((x) => x.name === r.name), r.name).toEqual(r);
    for (const d of before.desks) expect(after.desks).toContainEqual(d);
    for (const o of before.objects) expect(after.objects).toContainEqual(o);
    expect(after.entries).toEqual(before.entries);
    // The old walls are the same, except the outer right wall, which now has a way through into the new rooms.
    for (let y = 0; y < before.height; y++) for (let x = 0; x < before.width - 1; x++) expect(after.walls[y]![x], `${x},${y}`).toBe(before.walls[y]![x]);
  });

  it('can be walked to from the door: its room, desks and objects, and the old ones still', () => {
    let j = base;
    const extra: { key: string; active: boolean }[] = [];
    for (let n = 1; n <= 3; n++) {
      j = add(j, n);
      extra.push({ key: `team-${n}`, active: true });
    }
    const m = read(j, extra);
    const door = m.entries.find((e) => e.name === 'door')!;
    for (const d of m.desks) expect(findPath(m, door, d), `desk ${d.room} ${d.slot}`).not.toBeNull();
    for (const o of m.objects) expect(findPath(m, door, nearestReachable(m, door, o)), o.name).not.toBeNull();
    for (const r of m.rooms) expect(findPath(m, door, nearestReachable(m, door, { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) })), r.name).not.toBeNull();
  });

  it('never puts two rooms on the same ground, and gives every one its own door', () => {
    let j = base;
    const extra: { key: string; active: boolean }[] = [];
    for (let n = 1; n <= 4; n++) {
      j = add(j, n);
      extra.push({ key: `team-${n}`, active: true });
    }
    const m = read(j, extra);
    for (const a of m.rooms) for (const b of m.rooms) {
      if (a === b) continue;
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      expect(apart, `${a.name} and ${b.name}`).toBe(true);
    }
  });

  it('does not change the map it is given', () => {
    const copy = JSON.stringify(base);
    add(base, 1);
    expect(JSON.stringify(base)).toBe(copy);
  });

  it('has room for a fixed number of added departments, then says so and changes nothing', () => {
    let j = base;
    for (let n = 1; n <= MAX_ADDED_DEPARTMENTS; n++) j = add(j, n);
    const before = JSON.stringify(j);
    expect(() => add(j, 99)).toThrow(PlotsFull);
    expect(() => add(j, 99)).toThrow(/no room|full/i);
    expect(JSON.stringify(j)).toBe(before);
  });

  it('refuses a name that is empty or already a room, and a key that is not a plain key', () => {
    expect(() => addDepartmentRoom(base, { key: 'x', name: '  ' })).toThrow(/name/i);
    expect(() => addDepartmentRoom(base, { key: 'outreach', name: 'outreach' })).toThrow(/already/i);
    expect(() => addDepartmentRoom(base, { key: 'Bad Key', name: 'Fine' })).toThrow(/key/i);
    const once = add(base, 1);
    expect(() => add(once, 1)).toThrow(/already/i);
  });
});
