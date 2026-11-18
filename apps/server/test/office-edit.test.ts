import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus, type BusMessage } from '../src/bus';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

/** Editing the office from inside it (S6B-9): put scenery down and take it away, with the rules checked on the server. */
let sys: System;
let app: ReturnType<typeof createApp>;
let root = '';
const seen: BusMessage[] = [];
const json = { 'content-type': 'application/json' };
const put = (body: unknown) => app.request('/api/office/decor', { method: 'POST', headers: json, body: typeof body === 'string' ? body : JSON.stringify(body) });
const del = (id: string | number) => app.request(`/api/office/decor/${id}`, { method: 'DELETE', headers: json });
const map = async () => JSON.parse(await readFile(path.join(root, 'office.tmj'), 'utf8')) as { layers: { name: string; objects?: { id: number; name: string; x: number; y: number }[]; data?: number[] }[]; width: number };
const decor = async () => (await map()).layers.find((l) => l.name === 'decor')!.objects!;
/** A free tile in the hall, found from the office's own facts. */
const freeTile = async () => {
  const o = (await (await app.request('/api/office')).json()) as { map: { walls: string[]; rooms: { kind: string; x: number; y: number; w: number; h: number }[] } };
  const hall = o.map.rooms.find((r) => r.kind === 'hall')!;
  for (let y = hall.y + 1; y < hall.y + hall.h - 1; y++) for (let x = hall.x + 1; x < hall.x + hall.w - 1; x++) if (o.map.walls[y]![x] === '.' && o.map.walls[y]![x + 1] === '.' && o.map.walls[y + 1]![x] === '.') return { x, y };
  throw new Error('no free tile');
};

beforeAll(async () => {
  ({ sys } = await testSystem());
  root = await mkdtemp(path.join(tmpdir(), 'conclave-edit-'));
  await cp(sys.companyRoot, root, { recursive: true });
  const bus = new Bus();
  bus.subscribe((m) => seen.push(m));
  app = createApp({ pool: sys.app, workspaceId: sys.workspace.id, tokens: new RunTokens(), store: new MemoryOsStore(), bus, dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), companyRoot: root });
}, 240_000);
afterAll(async () => {
  await sys?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe('placing and removing scenery (S6B-9)', () => {
  it('places a piece, writes the map, tells the office, and the map the world draws has it', async () => {
    const at = await freeTile();
    const before = (await decor()).length;
    seen.length = 0;
    const r = await put({ name: 'plant', ...at });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: number };
    expect((await decor()).find((d) => d.id === id)).toMatchObject({ name: 'plant', x: at.x * 32, y: at.y * 32 });
    expect(await decor()).toHaveLength(before + 1);
    expect(seen.some((m) => m.kind === 'office.changed')).toBe(true);
    const served = (await (await app.request('/api/office/map')).json()) as { layers: { name: string; objects?: { id: number }[] }[] };
    expect(served.layers.find((l) => l.name === 'decor')!.objects!.some((d) => d.id === id)).toBe(true);
  });

  it('refuses what the rules refuse, with the reason, and writes nothing', async () => {
    const text = await readFile(path.join(root, 'office.tmj'), 'utf8');
    const at = await freeTile();
    const bad = [
      [{ name: 'dragon', ...at }, /picture/i],
      [{ name: 'plant', x: 0, y: 0 }, /wall/i],
      [{ name: 'plant', x: -3, y: 4 }, /fit/i],
      [{ name: 'plant', x: 1.5, y: 4 }, /whole/i],
      [{ name: 'chair', ...at, turn: 45 }, /turn/i],
    ] as const;
    for (const [body, why] of bad) {
      const r = await put(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(((await r.json()) as { error: string }).error).toMatch(why);
    }
    expect((await put('not json')).status).toBe(400);
    expect((await put({ name: 5 })).status).toBe(400);
    expect(await readFile(path.join(root, 'office.tmj'), 'utf8')).toBe(text);
  });

  it('lets only one of two pieces for the same tile in when they arrive together', async () => {
    const at = await freeTile();
    const second = { x: at.x + 1, y: at.y };
    const results = await Promise.all([put({ name: 'bin', ...second }), put({ name: 'bin', ...second })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
  });

  it('removes a piece, once, and says no to one that is not there and to a desk', async () => {
    const at = await freeTile();
    const placed = (await (await put({ name: 'printer', x: at.x, y: at.y })).json()) as { id?: number; error?: string };
    expect(placed.id, placed.error).toBeTruthy();
    expect((await del(placed.id!)).status).toBe(200);
    expect((await del(placed.id!)).status).toBe(404);
    expect((await del('abc')).status).toBe(404);
    const desks = (await map()).layers.find((l) => l.name === 'desks')!.objects!;
    expect((await del(desks[0]!.id)).status).toBe(404); // not scenery
  });
});

describe('moving a piece and undoing (S6C-2)', () => {
  const move = (id: number, body: unknown) => app.request(`/api/office/decor/${id}/move`, { method: 'POST', headers: json, body: JSON.stringify(body) });
  const undo = () => app.request('/api/office/undo', { method: 'POST', headers: json, body: '{}' });

  it('moves a piece to another tile in one change, and changes nothing when the new place is refused', async () => {
    const at = await freeTile();
    const placed = (await (await put({ name: 'plant', ...at })).json()) as { id: number };
    const to = { x: at.x + 1, y: at.y };
    expect((await move(placed.id, to)).status).toBe(200);
    const moved = (await decor()).find((d) => d.name === 'plant' && d.x === to.x * 32 && d.y === to.y * 32);
    expect(moved).toBeTruthy();
    const text = await readFile(path.join(root, 'office.tmj'), 'utf8');
    expect((await move(moved!.id, { x: 0, y: 0 })).status).toBe(400); // a wall
    expect(await readFile(path.join(root, 'office.tmj'), 'utf8')).toBe(text);
    expect((await move(999999, to)).status).toBe(404);
  });

  it('undoes the last change, one at a time, and then says there is nothing to undo', async () => {
    // Start from a known point: undo everything the earlier tests left in the history.
    for (let i = 0; i < 30; i++) if ((await undo()).status !== 200) break;
    const start = (await decor()).length;
    const at = await freeTile();
    await put({ name: 'bin', ...at });
    await put({ name: 'plant', x: at.x + 2, y: at.y });
    expect(await decor()).toHaveLength(start + 2);
    seen.length = 0;
    expect((await undo()).status).toBe(200);
    expect(await decor()).toHaveLength(start + 1);
    expect(seen.some((m) => m.kind === 'office.changed')).toBe(true);
    expect((await undo()).status).toBe(200);
    expect(await decor()).toHaveLength(start);
    expect((await undo()).status).toBe(404);
  });
});

describe('doors (S6C-2)', () => {
  const door = (b: unknown) => app.request('/api/office/door', { method: 'POST', headers: json, body: JSON.stringify(b) });
  const floorAt = async (x: number, y: number) => {
    const m = await map();
    return (m.layers.find((l) => l.name === 'floor') as unknown as { data: number[] }).data[y * (m as unknown as { width: number }).width + x];
  };
  /** A wall tile one thick with floor either side, found in the company map. */
  const thin = async () => {
    const m = (await map()) as unknown as { width: number; height: number };
    const f = ((await map()).layers.find((l) => l.name === 'floor') as unknown as { data: number[] }).data;
    for (let y = 2; y < m.height - 2; y++) for (let x = 2; x < m.width - 2; x++) if (f[y * m.width + x] === 2 && f[y * m.width + x - 1] !== 2 && f[y * m.width + x + 1] !== 2 && f[(y - 1) * m.width + x] === 2 && f[(y + 1) * m.width + x] === 2) return { x, y };
    throw new Error('no thin wall');
  };

  it('opens a wall, tells the office, closes it again with the same tile, and undo takes each one back', async () => {
    const at = await thin();
    seen.length = 0;
    const open = await door(at);
    expect(open.status).toBe(200);
    expect(await open.json()).toEqual({ ok: true, opened: true });
    expect(await floorAt(at.x, at.y)).not.toBe(2);
    expect(seen.some((m) => m.kind === 'office.changed')).toBe(true);
    const close = await door(at);
    expect(await close.json()).toEqual({ ok: true, opened: false });
    expect(await floorAt(at.x, at.y)).toBe(2);
    expect((await app.request('/api/office/undo', { method: 'POST', headers: json, body: '{}' })).status).toBe(200);
    expect(await floorAt(at.x, at.y)).not.toBe(2);
    expect((await app.request('/api/office/undo', { method: 'POST', headers: json, body: '{}' })).status).toBe(200);
    expect(await floorAt(at.x, at.y)).toBe(2);
  });

  it('refuses with the reason and writes nothing: a map edge, floor that is not a gap, and a bad body', async () => {
    const before = JSON.stringify(await map());
    const edge = await door({ x: 0, y: 3 });
    expect(edge.status).toBe(400);
    expect(((await edge.json()) as { error: string }).error).toMatch(/edge of the map/);
    expect((await door({ x: 'a', y: 3 })).status).toBe(400);
    expect((await door({ x: 5, y: 5, extra: 1 })).status).toBe(400);
    expect(JSON.stringify(await map())).toBe(before);
  });
});
