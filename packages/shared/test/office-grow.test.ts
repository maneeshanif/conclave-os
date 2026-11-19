import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EditError, growRoom, readOfficeMap, shrinkRoom, type OfficeMapJson } from '../src/office';

/** Making a room bigger in the office editor (S6C-2). */
const root = path.resolve(import.meta.dirname, '..', '..', '..');
const base = JSON.parse(readFileSync(path.join(root, 'templates', 'companies', 'starter', 'office.tmj'), 'utf8')) as OfficeMapJson;
const departments = [
  { key: 'chief-of-staff', active: true },
  { key: 'lead-gen', active: true },
  { key: 'outreach', active: true },
  { key: 'research', active: true },
];
const read = (j: OfficeMapJson) => readOfficeMap(j, { file: 'office.tmj', departments });
const room = (j: OfficeMapJson, name: string) => read(j).rooms.find((r) => r.name === name)!;
const floor = (j: OfficeMapJson) => j.layers.find((l) => l.name === 'floor')!.data!;

describe('growing a room (S6C-2)', () => {
  it('moves the east wall out by a tile: the room is a tile wider, the old wall tiles are floor and the new ones are wall', () => {
    const before = room(base, 'Research');
    const next = growRoom(base, { room: 'Research', side: 'east' }, departments);
    const after = room(next, 'Research');
    expect(after).toMatchObject({ x: before.x, y: before.y, w: before.w + 1, h: before.h });
    const m = read(next);
    for (let y = before.y; y < before.y + before.h; y++) {
      expect(m.walls[y]![before.x + before.w]).toBe(false); // where the wall was, you can walk
      expect(m.walls[y]![before.x + before.w + 1]).toBe(true); // the new wall
    }
    expect(JSON.stringify(base)).toBe(JSON.stringify(JSON.parse(JSON.stringify(base)))); // the input is not touched
    expect(room(base, 'Research').w).toBe(before.w);
  });

  it('grows south and takes a doorway with the wall', () => {
    const before = room(base, 'Research');
    const next = growRoom(base, { room: 'Research', side: 'south' }, departments);
    expect(room(next, 'Research')).toMatchObject({ h: before.h + 1, w: before.w });
    // The doorways that were in the south wall are in the new one, one row down.
    const f0 = floor(base);
    const f1 = floor(next);
    const W = base.width;
    const row = before.y + before.h;
    for (let x = before.x - 1; x <= before.x + before.w; x++) expect(f1[(row + 1) * W + x]).toBe(f0[row * W + x]);
  });

  it('refuses to grow into another room, a wall or off the map, and says why', () => {
    expect(() => growRoom(base, { room: 'Chief of Staff', side: 'east' }, departments)).toThrow(/Lead Gen is in the way/);
    expect(() => growRoom(base, { room: 'Chief of Staff', side: 'west' }, departments)).toThrow(EditError);
    expect(() => growRoom(base, { room: 'Chief of Staff', side: 'north' }, departments)).toThrow(EditError);
    expect(() => growRoom(base, { room: 'Nowhere', side: 'east' }, departments)).toThrow(/no room called/);
    expect(() => growRoom(base, { room: 'Research', side: 'up' }, departments)).toThrow(/north, south, east or west/);
  });

  it('can grow again and again until something is in the way, and every step still reads as a map', () => {
    let j = base;
    let steps = 0;
    for (; steps < 40; steps++) {
      try {
        j = growRoom(j, { room: 'Research', side: 'east' }, departments);
        read(j);
      } catch (err) {
        expect(err).toBeInstanceOf(EditError);
        break;
      }
    }
    expect(steps).toBeGreaterThan(0);
    expect(room(j, 'Research').w).toBe(room(base, 'Research').w + steps);
  });
});

describe('shrinking a room (S6C-2)', () => {
  it('undoes a grow exactly: grow east then shrink east gives back the same map', () => {
    for (const side of ['east', 'south'] as const) {
      const bigger = growRoom(base, { room: 'Research', side }, departments);
      const back = shrinkRoom(bigger, { room: 'Research', side }, departments);
      expect(floor(back)).toEqual(floor(base));
      expect(back.layers.find((l) => l.name === 'collision')!.data).toEqual(base.layers.find((l) => l.name === 'collision')!.data);
      expect(room(back, 'Research')).toMatchObject({ w: room(base, 'Research').w, h: room(base, 'Research').h });
    }
  });

  it('makes the room a tile smaller with the wall a tile in, and the old wall tiles open ground', () => {
    const before = room(base, 'Research');
    const wider = growRoom(base, { room: 'Research', side: 'east' }, departments);
    const smaller = shrinkRoom(wider, { room: 'Research', side: 'east' }, departments);
    expect(room(smaller, 'Research').w).toBe(before.w);
    expect(() => shrinkRoom(base, { room: 'Research', side: 'east' }, departments)).toThrow(/desk is in the way|in the way/); // a desk stands against that wall
    const m = read(wider);
    const after = read(shrinkRoom(wider, { room: 'Research', side: 'east' }, departments));
    for (let y = before.y; y < before.y + before.h; y++) {
      expect(m.walls[y]![before.x + before.w + 1]).toBe(true); // the wall of the bigger room
      expect(after.walls[y]![before.x + before.w + 1]).toBe(read(base).walls[y]![before.x + before.w + 1]); // what is beyond is as it was
      expect(after.walls[y]![before.x + before.w]).toBe(true); // the wall is back where it was
    }
  });

  it('refuses when the wall is shared with another room, when it is too small, and for a room that is not there', () => {
    expect(() => shrinkRoom(base, { room: 'Chief of Staff', side: 'east' }, departments)).toThrow(/shares that wall/);
    expect(() => shrinkRoom(base, { room: 'Nowhere', side: 'east' }, departments)).toThrow(/no room called/);
    expect(() => shrinkRoom(base, { room: 'Research', side: 'sideways' }, departments)).toThrow(/north, south, east or west/);
    let j = base;
    let steps = 0;
    for (; steps < 20; steps++) {
      try {
        j = shrinkRoom(j, { room: 'Research', side: 'east' }, departments);
      } catch (err) {
        expect(err).toBeInstanceOf(EditError);
        break;
      }
    }
    expect(room(j, 'Research').w).toBeGreaterThanOrEqual(2);
    expect(steps).toBeLessThan(20);
  });
});
