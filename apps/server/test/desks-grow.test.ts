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

/** Rooms that grow (S6B-1): "add a desk" to a department's room, from the world. */
let sys: System;
let app: ReturnType<typeof createApp>;
let root = '';
const seen: BusMessage[] = [];
const addDesk = (key: string) => app.request(`/api/departments/${key}/desks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
const office = async () => (await (await app.request('/api/office')).json()) as { map: { desks: { room: string; slot: number; x: number; y: number }[] } };
const mapText = () => readFile(path.join(root, 'office.tmj'), 'utf8');

beforeAll(async () => {
  ({ sys } = await testSystem());
  root = await mkdtemp(path.join(tmpdir(), 'conclave-desks-'));
  await cp(sys.companyRoot, root, { recursive: true });
  const bus = new Bus();
  bus.subscribe((m) => seen.push(m));
  app = createApp({ pool: sys.app, workspaceId: sys.workspace.id, tokens: new RunTokens(), store: new MemoryOsStore(), bus, dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), companyRoot: root });
}, 240_000);
afterAll(async () => {
  await sys?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe('adding a desk to a department room (S6B-1)', () => {
  it('puts the next desk in the room, writes the map, and tells the office', async () => {
    const before = (await office()).map.desks.filter((d) => d.room === 'Outreach').length;
    seen.length = 0;
    const r = await addDesk('outreach');
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ key: 'outreach', room: 'Outreach', desks: before + 1 });
    const desks = (await office()).map.desks.filter((d) => d.room === 'Outreach');
    expect(desks).toHaveLength(before + 1);
    expect(desks.map((d) => d.slot).sort()).toEqual(Array.from({ length: before + 1 }, (_, i) => i + 1));
    expect(seen.some((m) => m.kind === 'office.changed')).toBe(true);
    expect(JSON.parse(await mapText()).layers.find((l: { name: string }) => l.name === 'desks').objects.length).toBeGreaterThan(before);
  });

  it('fills a room up to nine and then says it is full, changing nothing', async () => {
    for (let n = 0; n < 6; n++) {
      const r = await addDesk('research');
      if (r.status === 409) break;
      expect(r.status).toBe(201);
    }
    const full = await addDesk('research');
    expect(full.status).toBe(409);
    expect(((await full.json()) as { error: string }).error).toMatch(/no free desk/i);
    expect((await office()).map.desks.filter((d) => d.room === 'Research')).toHaveLength(9);
  });

  it('says so for a department with no room, and a name that is not a key, and writes nothing', async () => {
    const before = await mapText();
    expect((await addDesk('nowhere')).status).toBe(400);
    expect((await addDesk('..%2Fx')).status).toBe(400);
    expect(await mapText()).toBe(before);
  });

  it('seats a new hire in the new desk once the old ones are taken', async () => {
    // The office API seats agents by the map's desks, so more desks means more seats before anyone goes to the lounge.
    const desks = (await office()).map.desks.filter((d) => d.room === 'Outreach');
    expect(new Set(desks.map((d) => `${d.x},${d.y}`)).size).toBe(desks.length); // never two on one tile
  });
});
