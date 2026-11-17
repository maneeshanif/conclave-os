import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// The same table the importers and the map script use, so the two cannot drift apart.
import { DECOR_FOOT } from '../../../scripts/lib/footprints.mjs';
import { DECOR_FOOTPRINT, EditError, findPath, nearestReachable, placeDecor, readOfficeMap, removeDecor, type OfficeMap, type OfficeMapJson } from '../src/office';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const base = JSON.parse(readFileSync(path.join(root, 'company', 'office.tmj'), 'utf8')) as OfficeMapJson;
const departments = readFileSync(path.join(root, 'company', 'departments.yaml'), 'utf8')
  .split(/\r?\n/)
  .flatMap((l) => {
    const m = /\{\s*key:\s*([a-z0-9-]+),.*active:\s*(true|false)/.exec(l);
    return m ? [{ key: m[1]!, active: m[2] === 'true' }] : [];
  });
const read = (j: OfficeMapJson): OfficeMap => readOfficeMap(j, { file: 'office.tmj', departments });
const place = (j: OfficeMapJson, p: { name: string; x: number; y: number; turn?: number }) => placeDecor(j, p, departments);
const decorOf = (j: OfficeMapJson) => j.layers.find((l) => l.name === 'decor')!.objects ?? [];
const m0 = read(base);
/** An open tile in the hall, away from everything. */
const hall = m0.rooms.find((r) => r.kind === 'hall')!;
const free = (() => {
  for (let y = hall.y + 1; y < hall.y + hall.h - 1; y++) for (let x = hall.x + 1; x < hall.x + hall.w - 1; x++) if (!m0.walls[y]![x] && !m0.walls[y]![x + 1] && !m0.walls[y + 1]![x]) return { x, y };
  throw new Error('no free tile');
})();

describe('editing the office from inside it (S6B-9)', () => {
  it('knows the same sizes as the scenery importers', () => {
    expect(DECOR_FOOTPRINT).toEqual(DECOR_FOOT);
  });

  it('places a piece of scenery, blocks the tiles it stands on, and leaves everything else as it was', () => {
    const before = decorOf(base).length;
    const j = place(base, { name: 'plant', ...free });
    expect(decorOf(j)).toHaveLength(before + 1);
    const m = read(j);
    expect(m.walls[free.y]![free.x]).toBe(true);
    expect(read(base).walls[free.y]![free.x]).toBe(false); // the input was not changed
    expect(m.rooms).toEqual(m0.rooms);
    expect(m.desks).toEqual(m0.desks);
  });

  it('does not block with a rug or a clock, which only lie or hang there', () => {
    const j = place(base, { name: 'rug', ...free });
    expect(read(j).walls[free.y]![free.x]).toBe(false);
  });

  it('turns a chair', () => {
    const j = place(base, { name: 'chair', ...free, turn: 90 });
    const d = decorOf(j).at(-1)!;
    expect(d.properties?.find((p) => p.name === 'turn')?.value).toBe(90);
    expect(() => place(base, { name: 'chair', ...free, turn: 45 })).toThrow(EditError);
  });

  it('refuses a picture we do not have, a place off the map, a wall, and a tile something stands on', () => {
    expect(() => place(base, { name: 'dragon', ...free })).toThrow(/picture/i);
    expect(() => place(base, { name: 'plant', x: -1, y: 3 })).toThrow(EditError);
    expect(() => place(base, { name: 'plant', x: base.width, y: 3 })).toThrow(EditError);
    expect(() => place(base, { name: 'tree', x: m0.width - 1, y: 2 })).toThrow(EditError); // runs off the edge
    const wall = (() => {
      for (let y = 0; y < m0.height; y++) for (let x = 0; x < m0.width; x++) if (m0.walls[y]![x]) return { x, y };
      throw new Error('no wall');
    })();
    expect(() => place(base, { name: 'plant', ...wall })).toThrow(/wall|in the way/i);
    const door = m0.entries.find((e) => e.name === 'door')!;
    expect(() => place(base, { name: 'plant', x: door.x, y: door.y })).toThrow(/door|entry/i);
    const desk = m0.desks[0]!;
    expect(() => place(base, { name: 'plant', x: desk.x, y: desk.y })).toThrow(EditError);
    const once = place(base, { name: 'plant', ...free });
    expect(() => place(once, { name: 'plant', ...free })).toThrow(/in the way|already/i);
  });

  it('refuses a piece that would cut a room, a desk or the front door off', () => {
    // Wall off the front door's lane: fill the row of the hall just inside it, one piece at a time, until one is refused.
    const door = m0.entries.find((e) => e.name === 'door')!;
    let j = base;
    let refused = false;
    for (let x = hall.x; x < hall.x + hall.w; x++) {
      try {
        j = place(j, { name: 'bin', x, y: door.y - 1 });
      } catch (err) {
        expect(err).toBeInstanceOf(EditError);
        expect((err as Error).message).toMatch(/block|cut off|reach/i);
        refused = true;
        break;
      }
    }
    expect(refused).toBe(true);
    const m = read(j);
    for (const r of m.rooms) expect(findPath(m, door, nearestReachable(m, door, { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) })), r.name).not.toBeNull();
  });

  it('removes a piece and frees its tiles, except where something else still stands or the wall is real', () => {
    const j = place(base, { name: 'plant', ...free });
    const added = decorOf(j).at(-1)!;
    const back = removeDecor(j, added.id!);
    expect(decorOf(back)).toHaveLength(decorOf(base).length);
    expect(read(back).walls[free.y]![free.x]).toBe(false);
    // A picture that stands on a real wall tile or under something else does not free those.
    const first = decorOf(base).find((d) => d.name === 'bookshelf')!;
    const m = read(removeDecor(base, first.id!));
    for (let y = first.y / 32; y < first.y / 32 + 1; y++) expect(m.walls[y]![first.x / 32]).toBe(false);
  });

  it('refuses to remove something that is not scenery', () => {
    expect(() => removeDecor(base, 999999)).toThrow(EditError);
    const aDesk = base.layers.find((l) => l.name === 'desks')!.objects![0]!;
    expect(() => removeDecor(base, aDesk.id!)).toThrow(EditError); // desks are added with Add a desk, not here
  });
});
