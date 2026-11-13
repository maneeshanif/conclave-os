import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readOfficeMap, type OfficeMap, type OfficeMapJson } from '@conclave/shared';
import { WorldController } from '../office/controller';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const departments = readFileSync(path.join(root, 'company', 'departments.yaml'), 'utf8')
  .split(/\r?\n/)
  .flatMap((l) => {
    const m = /\{\s*key:\s*([a-z0-9-]+),.*active:\s*(true|false)/.exec(l);
    return m ? [{ key: m[1]!, active: m[2] === 'true' }] : [];
  });
const map: OfficeMap = readOfficeMap(JSON.parse(readFileSync(path.join(root, 'company', 'office.tmj'), 'utf8')) as OfficeMapJson, { file: 'office.tmj', departments });
const door = map.entries.find((e) => e.name === 'door')!;
const desk = map.desks[0]!;
const lounge = map.rooms.find((r) => r.kind === 'lounge')!;
const spot = { x: lounge.x + 1, y: lounge.y + 1 };

describe('the world, without drawing it (S6-8b)', () => {
  it('starts you at the door, and puts an agent on its tile the first time it is seen', () => {
    const w = new WorldController(map);
    expect(w.me.tile).toEqual({ x: door.x, y: door.y });
    w.setAgents([{ agentId: 'a1', x: desk.x, y: desk.y }]);
    expect(w.agents().find((a) => a.id === 'a1')!.position).toEqual({ x: desk.x, y: desk.y });
  });

  it('walks an agent to its new place when the place changes, instead of jumping', () => {
    const w = new WorldController(map, { agentSpeed: 4 });
    w.setAgents([{ agentId: 'a1', x: desk.x, y: desk.y }]);
    w.setAgents([{ agentId: 'a1', x: spot.x, y: spot.y }]);
    w.tick(100);
    const p = w.agents()[0]!.position;
    expect(p).not.toEqual({ x: spot.x, y: spot.y });
    expect(p).not.toEqual({ x: desk.x, y: desk.y });
    w.tick(60_000);
    expect(w.agents()[0]!.position).toEqual({ x: spot.x, y: spot.y });
  });

  it('drops an agent that is no longer there', () => {
    const w = new WorldController(map);
    w.setAgents([{ agentId: 'a1', x: desk.x, y: desk.y }]);
    w.setAgents([]);
    expect(w.agents()).toEqual([]);
  });

  it('walks you to a clicked tile, to the nearest open tile for a click on a wall, and one step on an arrow key', () => {
    const w = new WorldController(map, { speed: 8 });
    expect(w.click(spot)).toBe(true);
    w.tick(60_000);
    expect(w.me.tile).toEqual(spot);
    const before = w.me.tile;
    w.key('right');
    w.tick(60_000);
    expect(Math.abs(w.me.tile.x - before.x) + Math.abs(w.me.tile.y - before.y)).toBeLessThanOrEqual(1);
    const wall = (() => {
      for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.walls[y]![x]) return { x, y };
      throw new Error('no wall');
    })();
    expect(w.click(wall)).toBe(true);
    w.tick(60_000);
    expect(map.walls[w.me.tile.y]![w.me.tile.x]).toBe(false);
  });

  it('opens the drawer once when you walk up to an agent and closes it when you walk away', () => {
    const w = new WorldController(map, { speed: 8 });
    w.setAgents([{ agentId: 'a1', x: spot.x + 1, y: spot.y }]);
    const events: string[] = [];
    w.onDrawer((e) => events.push(`${e.kind}:${e.id}`));
    w.click(spot);
    for (let i = 0; i < 400; i++) w.tick(50);
    expect(events).toEqual(['open:a1']);
    w.click({ x: door.x, y: door.y });
    for (let i = 0; i < 1200; i++) w.tick(50);
    expect(events).toEqual(['open:a1', 'close:a1']);
  });

  it('opens a drawer from the list and keeps it until closed', () => {
    const w = new WorldController(map);
    const events: string[] = [];
    w.onDrawer((e) => events.push(`${e.kind}:${e.id}`));
    w.openDrawer('a1');
    w.click(spot);
    w.tick(60_000);
    w.closeDrawer();
    expect(events).toEqual(['open:a1', 'close:a1']);
  });

  it('tracks which room you are in', () => {
    const w = new WorldController(map, { speed: 8 });
    w.click(spot);
    w.tick(60_000);
    expect(w.presence.snapshot()[0]!.room).toBe(lounge.name);
  });

  it('stops moving while the tab is hidden, and snaps everyone to where they should be when it is shown again', () => {
    const w = new WorldController(map, { agentSpeed: 1 });
    w.setAgents([{ agentId: 'a1', x: desk.x, y: desk.y }]);
    w.setAgents([{ agentId: 'a1', x: spot.x, y: spot.y }]);
    w.setVisible(false);
    expect(w.running).toBe(false);
    const frozen = w.agents()[0]!.position;
    w.tick(10_000);
    expect(w.agents()[0]!.position).toEqual(frozen);
    w.setVisible(true);
    expect(w.running).toBe(true);
    expect(w.agents()[0]!.position).toEqual({ x: spot.x, y: spot.y });
  });
});

describe('zoom and held keys (S6-8c1)', () => {
  const fresh = () => {
    const w = new WorldController(map, { speed: 8 });
    w.setViewport(640, 384);
    return w;
  };

  it('starts zoomed in about twice, and the overview fits the whole map', () => {
    const w = fresh();
    expect(w.zoom).toBe(2);
    w.overview(true);
    const fit = Math.min(640 / (map.width * map.tile), 384 / (map.height * map.tile));
    expect(w.zoom).toBeCloseTo(fit, 5);
    expect(fit * map.width * map.tile).toBeLessThanOrEqual(640 + 1e-6);
    expect(fit * map.height * map.tile).toBeLessThanOrEqual(384 + 1e-6);
    w.overview(false);
    expect(w.zoom).toBe(2);
  });

  it('zooms in and out in steps, never past the limits', () => {
    const w = fresh();
    for (let i = 0; i < 20; i++) w.zoomIn();
    expect(w.zoom).toBe(3);
    for (let i = 0; i < 40; i++) w.zoomOut();
    const fit = Math.min(640 / (map.width * map.tile), 384 / (map.height * map.tile));
    expect(w.zoom).toBeCloseTo(fit, 5);
    w.zoomIn();
    expect(w.zoom).toBeGreaterThan(fit);
  });

  it('on a big screen the lowest zoom is never less than showing the whole map', () => {
    const w = new WorldController(map);
    w.setViewport(4000, 3000);
    expect(w.zoom).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < 40; i++) w.zoomOut();
    expect(w.zoom).toBeGreaterThanOrEqual(1);
  });

  it('keeps walking while a key is held, and stops on a whole tile when it is let go', () => {
    const w = fresh();
    w.click(spot);
    w.tick(60_000);
    const start = w.me.tile;
    w.hold('right');
    w.tick(300);
    w.tick(300);
    expect(w.me.position.x).toBeGreaterThan(start.x + 1);
    w.hold(null);
    w.tick(10_000);
    const end = w.me.tile;
    expect(w.me.position).toEqual(end);
    expect(end.y).toBe(start.y);
    expect(end.x).toBeGreaterThan(start.x + 1);
    expect(map.walls[end.y]![end.x]).toBe(false);
  });

  it('does not walk through a wall while a key is held', () => {
    const w = fresh();
    w.click(spot);
    w.tick(60_000);
    w.hold('down');
    for (let i = 0; i < 200; i++) w.tick(100);
    const t = w.me.tile;
    expect(map.walls[t.y]![t.x]).toBe(false);
    expect(map.walls[t.y + 1]![t.x] || t.y + 1 >= map.height).toBe(true); // it ran to the wall and stayed
  });

  it('a hidden tab does not walk you', () => {
    const w = fresh();
    w.click(spot);
    w.tick(60_000);
    w.setVisible(false);
    const before = w.me.position;
    w.hold('left');
    w.tick(5000);
    expect(w.me.position).toEqual(before);
  });
});

describe('telling you which room you are in (S6-8c2)', () => {
  it('says the room once when you walk in, and null once when you leave it', () => {
    const w = new WorldController(map, { speed: 8 });
    const seen: (string | null)[] = [];
    w.onZone((room) => seen.push(room?.name ?? null));
    w.click(spot);
    for (let i = 0; i < 400; i++) w.tick(50);
    expect(seen.at(-1)).toBe(lounge.name);
    const n = seen.length;
    for (let i = 0; i < 50; i++) w.tick(50);
    expect(seen.length).toBe(n);
    w.click({ x: door.x, y: door.y });
    for (let i = 0; i < 1200; i++) w.tick(50);
    expect(seen.length).toBeGreaterThan(n);
    expect(new Set(seen.filter((s) => s === lounge.name)).size).toBe(1);
  });
});
