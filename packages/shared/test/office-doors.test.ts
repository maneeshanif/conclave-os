import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EditError, readOfficeMap, setDoor, type OfficeMapJson } from '../src/office';

/** Opening and closing doors in the office editor (S6C-2). */
const root = path.resolve(import.meta.dirname, '..', '..', '..');
const base = JSON.parse(readFileSync(path.join(root, 'templates', 'companies', 'starter', 'office.tmj'), 'utf8')) as OfficeMapJson;
const departments = [
  { key: 'chief-of-staff', active: true },
  { key: 'lead-gen', active: true },
  { key: 'outreach', active: true },
  { key: 'research', active: true },
];
const layer = (j: OfficeMapJson, n: string) => j.layers.find((l) => l.name === n)!.data!;
const read = (j: OfficeMapJson) => readOfficeMap(j, { file: 'office.tmj', departments });

/** A wall tile one thick with floor on both sides, found by looking. */
function thinWall(j: OfficeMapJson): { x: number; y: number } {
  const f = layer(j, 'floor');
  const W = j.width;
  for (let y = 2; y < j.height - 2; y++) for (let x = 2; x < W - 2; x++) if (f[y * W + x] === 2 && f[y * W + x - 1] !== 2 && f[y * W + x + 1] !== 2 && f[(y - 1) * W + x] === 2 && f[(y + 1) * W + x] === 2) return { x, y };
  throw new Error('no thin wall found');
}

describe('doors (S6C-2)', () => {
  it('opens a thin wall into floor you can walk through, and closes it back to exactly what it was', () => {
    const at = thinWall(base);
    const before = JSON.stringify(base);
    const opened = setDoor(base, { ...at, open: true }, departments);
    expect(JSON.stringify(base)).toBe(before); // the input is not changed
    expect(read(opened).walls[at.y]![at.x]).toBe(false);
    const closed = setDoor(opened, { ...at, open: false }, departments);
    expect(layer(closed, 'floor')).toEqual(layer(base, 'floor'));
    expect(layer(closed, 'collision')).toEqual(layer(base, 'collision'));
    expect(read(closed).walls[at.y]![at.x]).toBe(true);
  });

  it('refuses a door on a map edge, on floor, and with a tile that is not whole', () => {
    expect(() => setDoor(base, { x: 0, y: 5, open: true }, departments)).toThrow(/edge of the map/);
    expect(() => setDoor(base, { x: 1.5, y: 5, open: true }, departments)).toThrow(EditError);
    const at = thinWall(base);
    const opened = setDoor(base, { ...at, open: true }, departments);
    expect(() => setDoor(opened, { ...at, open: true }, departments)).toThrow(/not a wall/);
    // A tile in the middle of open floor is not a gap in a wall.
    const f = layer(base, 'floor');
    const W = base.width;
    let floorTile: { x: number; y: number } | null = null;
    for (let y = 3; y < base.height - 3 && !floorTile; y++) for (let x = 3; x < W - 3; x++) if (f[y * W + x] !== 2 && f[y * W + x - 1] !== 2 && f[y * W + x + 1] !== 2 && f[(y - 1) * W + x] !== 2 && f[(y + 1) * W + x] !== 2) { floorTile = { x, y }; break; }
    expect(() => setDoor(base, { ...floorTile!, open: false }, departments)).toThrow(/not a gap in a wall/);
  });

  it('refuses to close the front door, and a gap that is the only way into a room', () => {
    const m = read(base);
    const front = m.entries.find((e) => e.name === 'door')!;
    expect(() => setDoor(base, { x: front.x, y: front.y, open: false }, departments)).toThrow(EditError);
    // Try closing every gap in the headquarters: some are the only way in, and those are refused.
    const f = layer(base, 'floor');
    let refused = 0;
    for (let y = 2; y < 36; y++)
      for (let x = 2; x < 45; x++) {
        if (f[y * base.width + x] === 2) continue;
        try {
          setDoor(base, { x, y, open: false }, departments);
        } catch (err) {
          if (err instanceof EditError && /block the way/.test(err.message)) refused++;
        }
      }
    expect(refused).toBeGreaterThan(0);
  });
});
