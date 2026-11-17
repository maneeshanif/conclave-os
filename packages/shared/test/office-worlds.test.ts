import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findPath, nearestReachable, readOfficeMap, type OfficeMapJson } from '../src/office';

/** The extra worlds (company/worlds/*.tmj): social places with a door, rooms of a kind, and scenery; no departments, no desks. */
const root = path.resolve(import.meta.dirname, '..', '..', '..');
const dir = path.join(root, 'company', 'worlds');
const files = readdirSync(dir).filter((f) => f.endsWith('.tmj'));
const decorFiles = new Set(readdirSync(path.join(root, 'apps', 'web', 'public', 'office', 'decor')).map((f) => f.replace(/\.png$/, '')));

describe('the extra worlds (S6-17)', () => {
  it('has at least four, and the starter company template has the same ones', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(readdirSync(path.join(root, 'templates', 'companies', 'starter', 'worlds')).sort()).toEqual([...files].sort());
  });

  for (const file of files) {
    const json = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as OfficeMapJson & { properties?: { name: string; value: string }[] };
    const read = () => readOfficeMap(json, { file, departments: [] });

    it(`${file}: loads with no departments, has a title, a door and a lounge`, () => {
      const m = read();
      expect(json.properties?.find((p) => p.name === 'title')?.value).toBeTruthy();
      expect(m.entries.some((e) => e.name === 'door')).toBe(true);
      expect(m.rooms.some((r) => r.kind === 'lounge')).toBe(true);
      expect(m.desks).toEqual([]);
    });

    it(`${file}: every room can be walked to from the door, and the door is on open floor`, () => {
      const m = read();
      const door = m.entries.find((e) => e.name === 'door')!;
      expect(m.walls[door.y]![door.x]).toBe(false);
      for (const r of m.rooms) {
        const mid = nearestReachable(m, door, { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });
        expect(findPath(m, door, mid), `${r.name} from the door`).not.toBeNull();
      }
      for (const e of m.entries) expect(findPath(m, door, nearestReachable(m, door, e)), e.name).not.toBeNull();
    });

    it(`${file}: its scenery uses only pictures we have, inside the map`, () => {
      const decor = json.layers.find((l) => l.name === 'decor')!.objects ?? [];
      expect(decor.length).toBeGreaterThan(5);
      for (const d of decor) {
        expect(decorFiles.has(d.name ?? ''), `${d.name}`).toBe(true);
        expect(d.x >= 0 && d.y >= 0 && d.x + (d.width ?? 0) <= json.width * 32 && d.y + (d.height ?? 0) <= json.height * 32, `${d.name} at ${d.x},${d.y}`).toBe(true);
      }
    });
  }
});
