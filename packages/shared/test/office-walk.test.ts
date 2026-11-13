import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findPath, nearestReachable, readOfficeMap, stepFrom, Walker, type OfficeMap, type OfficeMapJson } from '../src/office';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const departments = readFileSync(path.join(root, 'company', 'departments.yaml'), 'utf8')
  .split(/\r?\n/)
  .flatMap((l) => {
    const m = /\{\s*key:\s*([a-z0-9-]+),.*active:\s*(true|false)/.exec(l);
    return m ? [{ key: m[1]!, active: m[2] === 'true' }] : [];
  });
const map: OfficeMap = readOfficeMap(JSON.parse(readFileSync(path.join(root, 'company', 'office.tmj'), 'utf8')) as OfficeMapJson, { file: 'office.tmj', departments });
const door = map.entries.find((e) => e.name === 'door')!;
const centre = (name: string) => {
  const r = map.rooms.find((x) => x.name === name)!;
  return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
};
/** A tiny map of our own for the exact cases: a wall with one gap, and a sealed box. */
const tiny = (rows: string[]): OfficeMap => ({ width: rows[0]!.length, height: rows.length, tile: 32, walls: rows.map((r) => [...r].map((c) => c === '#')), rooms: [], desks: [], objects: [], entries: [] });

describe('finding a path (S6-4)', () => {
  it('finds the shortest way, not stepping on a wall and not cutting corners', () => {
    const m = tiny(['.....', '.###.', '.....']);
    const p = findPath(m, { x: 0, y: 1 }, { x: 4, y: 1 })!;
    expect(p[0]).toEqual({ x: 0, y: 1 });
    expect(p.at(-1)).toEqual({ x: 4, y: 1 });
    expect(p).toHaveLength(7); // up or down and around: 6 steps
    for (const t of p) expect(m.walls[t.y]![t.x]).toBe(false);
    for (let i = 1; i < p.length; i++) expect(Math.abs(p[i]!.x - p[i - 1]!.x) + Math.abs(p[i]!.y - p[i - 1]!.y)).toBe(1);
  });

  it('is just the start when you are already there, and null for a wall or a sealed-off tile', () => {
    const m = tiny(['..#..', '..#..', '..#..']);
    expect(findPath(m, { x: 0, y: 0 }, { x: 0, y: 0 })).toEqual([{ x: 0, y: 0 }]);
    expect(findPath(m, { x: 0, y: 0 }, { x: 2, y: 1 })).toBeNull(); // a wall
    expect(findPath(m, { x: 0, y: 0 }, { x: 4, y: 0 })).toBeNull(); // the other side of the wall
  });

  it('is the same every time', () => {
    const a = findPath(map, door, centre('Outreach'));
    expect(findPath(map, door, centre('Outreach'))).toEqual(a);
  });

  it('gets from the door to every room, and to every desk, object and entry', () => {
    for (const r of map.rooms) expect(findPath(map, door, centre(r.name)), r.name).not.toBeNull();
    for (const d of map.desks) expect(findPath(map, door, d), `desk ${d.room} ${d.slot}`).not.toBeNull();
    for (const o of map.objects) expect(findPath(map, door, o), o.name).not.toBeNull();
    for (const e of map.entries) expect(findPath(map, door, e), e.name).not.toBeNull();
  });

  it('never crosses a wall on the way to a room', () => {
    for (const r of map.rooms) for (const t of findPath(map, door, centre(r.name))!) expect(map.walls[t.y]![t.x], `${r.name} at ${t.x},${t.y}`).toBe(false);
  });

  it('goes from one room to the next only through open floor, never through the wall between them', () => {
    const a = centre('Chief of Staff');
    const b = centre('Lead Gen');
    const p = findPath(map, a, b)!;
    expect(p.length - 1).toBeGreaterThanOrEqual(Math.abs(a.x - b.x) + Math.abs(a.y - b.y));
    for (const t of p) expect(map.walls[t.y]![t.x]).toBe(false);
  });
});

describe('a click on a wall (S6-4)', () => {
  it('goes to the nearest tile you can reach', () => {
    const m = tiny(['.....', '.###.', '.....']);
    expect(nearestReachable(m, { x: 0, y: 0 }, { x: 2, y: 1 })).toEqual({ x: 2, y: 0 });
  });

  it('is the tile itself when it can be reached, and the closest reachable one when it is sealed off', () => {
    const m = tiny(['..#..', '..#..', '..#..']);
    expect(nearestReachable(m, { x: 0, y: 1 }, { x: 1, y: 1 })).toEqual({ x: 1, y: 1 });
    expect(nearestReachable(m, { x: 0, y: 1 }, { x: 4, y: 1 })).toEqual({ x: 1, y: 1 }); // the other side is out of reach: stop at the wall
  });

  it('works on the real map: a click on a wall between rooms lands on open floor', () => {
    const t = nearestReachable(map, door, { x: 10, y: 5 })!; // the wall between Chief of Staff and Lead Gen
    expect(map.walls[t.y]![t.x]).toBe(false);
    expect(Math.abs(t.x - 10) + Math.abs(t.y - 5)).toBeLessThanOrEqual(2);
  });
});

describe('arrow-key steps (S6-4)', () => {
  const m = tiny(['...', '.#.', '...']);
  it('move one tile, and stop at a wall or the edge of the map', () => {
    expect(stepFrom(m, { x: 0, y: 0 }, 'right')).toEqual({ x: 1, y: 0 });
    expect(stepFrom(m, { x: 0, y: 0 }, 'down')).toEqual({ x: 0, y: 1 });
    expect(stepFrom(m, { x: 0, y: 1 }, 'right')).toEqual({ x: 0, y: 1 }); // the wall
    expect(stepFrom(m, { x: 0, y: 0 }, 'up')).toEqual({ x: 0, y: 0 }); // the edge
    expect(stepFrom(m, { x: 2, y: 2 }, 'right')).toEqual({ x: 2, y: 2 });
  });
});

describe('walking over time (S6-4)', () => {
  it('takes the steps it needs at its speed, and is there at the end', () => {
    const w = new Walker(map, door, 4); // four tiles a second
    const path = findPath(map, door, centre('Outreach'))!;
    w.walkTo(centre('Outreach'));
    const steps = path.length - 1;
    w.tick((steps / 4) * 1000 - 1);
    expect(w.arrived).toBe(false);
    w.tick(2);
    expect(w.arrived).toBe(true);
    expect(w.tile).toEqual(centre('Outreach'));
  });

  it('moves smoothly between tiles: half a step in, it is half way', () => {
    const m = tiny(['.....']);
    const w = new Walker(m, { x: 0, y: 0 }, 2);
    w.walkTo({ x: 4, y: 0 });
    w.tick(250); // 0.5 tiles at two a second
    expect(w.position.x).toBeCloseTo(0.5, 5);
    expect(w.tile).toEqual({ x: 0, y: 0 });
    w.tick(250);
    expect(w.position.x).toBeCloseTo(1, 5);
    expect(w.tile).toEqual({ x: 1, y: 0 });
  });

  it('turns round from where it is when told somewhere else mid-walk', () => {
    const m = tiny(['.......']);
    const w = new Walker(m, { x: 0, y: 0 }, 1);
    w.walkTo({ x: 6, y: 0 });
    w.tick(3000);
    expect(w.tile).toEqual({ x: 3, y: 0 });
    w.walkTo({ x: 0, y: 0 });
    w.tick(3000);
    expect(w.tile).toEqual({ x: 0, y: 0 });
    expect(w.arrived).toBe(true);
  });

  it('stays put when there is no way, and says so', () => {
    const m = tiny(['..#..']);
    const w = new Walker(m, { x: 0, y: 0 }, 4);
    expect(w.walkTo({ x: 4, y: 0 })).toBe(false);
    w.tick(5000);
    expect(w.tile).toEqual({ x: 0, y: 0 });
  });

  it('can be put somewhere at once (arriving at the door)', () => {
    const w = new Walker(map, door, 4);
    w.teleport(centre('Lounge'));
    expect(w.tile).toEqual(centre('Lounge'));
    expect(w.arrived).toBe(true);
  });
});

describe('stopping and turning smoothly (S6-8c1)', () => {
  it('stops at the end of the step it is on, not half way through it', () => {
    const m = tiny(['.......']);
    const w = new Walker(m, { x: 0, y: 0 }, 2);
    w.walkTo({ x: 6, y: 0 });
    w.tick(700); // 1.4 tiles in
    w.stop();
    w.tick(10_000);
    expect(w.tile).toEqual({ x: 2, y: 0 });
    expect(w.position).toEqual({ x: 2, y: 0 });
    expect(w.arrived).toBe(true);
  });

  it('stopping when already still does nothing', () => {
    const m = tiny(['...']);
    const w = new Walker(m, { x: 1, y: 0 }, 2);
    w.stop();
    expect(w.tile).toEqual({ x: 1, y: 0 });
  });

  it('keeps its place between tiles when told to go somewhere else, instead of snapping back', () => {
    const m = tiny(['.......']);
    const w = new Walker(m, { x: 0, y: 0 }, 2);
    w.walkTo({ x: 6, y: 0 });
    w.tick(250); // half a tile in
    expect(w.position.x).toBeCloseTo(0.5, 5);
    w.walkTo({ x: 4, y: 0 });
    expect(w.position.x).toBeCloseTo(0.5, 5);
    w.tick(10_000);
    expect(w.tile).toEqual({ x: 4, y: 0 });
  });
});
