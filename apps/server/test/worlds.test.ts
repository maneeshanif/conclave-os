import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { HQ, listWorlds, worldKey } from '../src/office/worlds';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

/** Many worlds (S6-17): the headquarters office and the extra social maps in company/worlds. */
describe('naming a world', () => {
  it('accepts a plain key and falls back to the headquarters for anything else', () => {
    expect(worldKey(undefined)).toBe(HQ);
    expect(worldKey('')).toBe(HQ);
    expect(worldKey('campus')).toBe('campus');
    for (const bad of ['../etc', 'a/b', 'A B', '..', 'x'.repeat(40), 'hq ']) expect(worldKey(bad), bad).toBe(HQ);
  });
});

describe('listing the worlds', () => {
  let dir = '';
  afterAll(async () => dir && rm(dir, { recursive: true, force: true }));

  it('puts the headquarters first, then each map in company/worlds by title, and skips files that are not maps', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'conclave-worlds-'));
    await mkdir(path.join(dir, 'worlds'), { recursive: true });
    const map = (title: string) => JSON.stringify({ width: 1, height: 1, layers: [], properties: [{ name: 'title', type: 'string', value: title }, { name: 'blurb', type: 'string', value: `About ${title}` }] });
    await writeFile(path.join(dir, 'worlds', 'zoo.tmj'), map('Zoo'));
    await writeFile(path.join(dir, 'worlds', 'alps.tmj'), map('Alps'));
    await writeFile(path.join(dir, 'worlds', 'notes.txt'), 'not a map');
    await writeFile(path.join(dir, 'worlds', 'Bad Name.tmj'), map('Bad'));
    await writeFile(path.join(dir, 'worlds', 'broken.tmj'), '{nope');
    const list = await listWorlds(dir);
    expect(list.map((w) => w.key)).toEqual(['hq', 'alps', 'zoo']);
    expect(list[1]).toMatchObject({ name: 'Alps', blurb: 'About Alps' });
  });

  it('is just the headquarters when there is no worlds folder', async () => {
    expect((await listWorlds(path.join(tmpdir(), 'conclave-no-such-company'))).map((w) => w.key)).toEqual(['hq']);
  });
});

describe('the world routes', () => {
  let sys: System;
  let app: ReturnType<typeof createApp>;
  const ws = () => sys.workspace.id;
  const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
  const get = (u: string) => app.request(u);

  beforeAll(async () => {
    ({ sys } = await testSystem());
    app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), companyRoot: sys.companyRoot, templatesRoot: sys.templatesRoot });
    await agentNew(sys, { template: 'researcher', department: 'research', id: 'world-visitor' });
  }, 240_000);
  afterAll(async () => sys?.close());

  it('lists the worlds: the headquarters and at least the four extra maps', async () => {
    const r = await get('/api/office/worlds');
    expect(r.status).toBe(200);
    const { worlds } = (await r.json()) as { worlds: { key: string; name: string }[] };
    expect(worlds[0]).toMatchObject({ key: 'hq' });
    for (const k of ['campus', 'loft', 'arcade', 'rooftop']) expect(worlds.some((w) => w.key === k), k).toBe(true);
  });

  it('serves the map of the world asked for, the office with none, and says no to a world that is not there', async () => {
    const hq = (await (await get('/api/office/map')).json()) as { width: number };
    const campus = (await (await get('/api/office/map?world=campus')).json()) as { width: number; properties: { name: string }[] };
    expect(hq.width).toBe(40);
    expect(campus.width).toBe(48);
    expect(campus.properties.some((p) => p.name === 'title')).toBe(true);
    expect((await get('/api/office/map?world=nowhere')).status).toBe(404);
    // A bad name is the office, not a path out of the folder.
    expect(((await (await get('/api/office/map?world=..%2Fcompany')).json()) as { width: number }).width).toBe(40);
  });

  it('gives the facts of a world, with the agents but no desks', async () => {
    const r = await get('/api/office?world=loft');
    expect(r.status).toBe(200);
    const body = (await r.json()) as { map: { width: number; desks: unknown[]; rooms: { name: string }[] }; agents: { key: string; desk: number | null; room: string | null }[] };
    expect(body.map.width).toBe(44);
    expect(body.map.desks).toEqual([]);
    expect(body.map.rooms.some((x) => x.name === 'Library')).toBe(true);
    expect(body.agents.find((a) => a.key === 'world-visitor')).toMatchObject({ desk: null, room: null });
  });

  it('puts the agents in the lounge of another world, and leaves their desks at the headquarters alone', async () => {
    await get('/api/office'); // the headquarters seats the agent first
    const before = (await sql('select agent_id, room, slot from office_desks order by agent_id')).rows;
    expect(before.length).toBeGreaterThan(0);
    const r = await get('/api/office/state?world=rooftop');
    expect(r.status).toBe(200);
    const { places } = (await r.json()) as { places: { key: string; place: string; x: number; y: number }[] };
    const p = places.find((x) => x.key === 'world-visitor')!;
    expect(p.place).toBe('lounge');
    expect((await sql('select agent_id, room, slot from office_desks order by agent_id')).rows).toEqual(before);
    const hqPlaces = (await (await get('/api/office/state')).json()) as { places: { key: string }[] };
    expect(hqPlaces.places.some((x) => x.key === 'world-visitor')).toBe(true);
  });
});
