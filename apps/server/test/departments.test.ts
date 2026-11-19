import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus, type BusMessage } from '../src/bus';
import { loadCompany } from '../src/company/loader';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

let sys: System;
let app: ReturnType<typeof createApp>;
let root = '';
const seen: BusMessage[] = [];
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const post = (body: unknown) => app.request('/api/departments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const files = async () => ({ map: await readFile(path.join(root, 'office.tmj'), 'utf8'), yaml: await readFile(path.join(root, 'departments.yaml'), 'utf8') });
type Office = { map: { rooms: { name: string; department: string | null }[]; desks: { room: string }[]; objects: { name: string; type: string }[] } };
const office = async () => (await (await app.request('/api/office')).json()) as Office;

beforeAll(async () => {
  ({ sys } = await testSystem());
  root = await mkdtemp(path.join(tmpdir(), 'conclave-dept-'));
  await cp(sys.companyRoot, root, { recursive: true });
  const bus = new Bus();
  bus.subscribe((m) => seen.push(m));
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus, dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), companyRoot: root });
}, 240_000);
afterAll(async () => {
  await sys?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe('adding a department from the world (S6-13b)', () => {
  it('stamps a room into the map, lists the department in the company folder and in the database, and tells the office', async () => {
    seen.length = 0;
    const r = await post({ name: 'Sales Team' });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ key: 'sales-team', name: 'Sales Team' });
    const f = await files();
    expect(f.yaml).toMatch(/key:\s*sales-team/);
    const o = await office();
    expect(o.map.rooms).toContainEqual(expect.objectContaining({ name: 'Sales Team', department: 'sales-team' }));
    expect(o.map.desks.filter((d) => d.room === 'Sales Team')).toHaveLength(6);
    expect(o.map.objects.filter((x) => x.name.startsWith('Sales Team '))).toHaveLength(2);
    expect((await sql("select name from departments where key = 'sales-team'")).rows).toEqual([{ name: 'Sales Team' }]);
    expect((await loadCompany(root)).departments.find((d) => d.key === 'sales-team')).toMatchObject({ name: 'Sales Team', active: true });
    expect(seen.some((m) => m.kind === 'office.changed')).toBe(true);
  });

  it('refuses a department that already exists, by name or by key, and changes nothing', async () => {
    const before = await files();
    for (const name of ['Sales Team', 'sales team', 'Outreach', 'Sales-Team']) {
      const r = await post({ name });
      expect(r.status, name).toBe(400);
      expect(((await r.json()) as { error: string }).error).toMatch(/already/i);
    }
    expect(await files()).toEqual(before);
  });

  it('refuses a missing or empty name and bad input, and changes nothing', async () => {
    const before = await files();
    for (const body of [{}, { name: '' }, { name: '   ' }, { name: '!!!' }, { name: 5 }, { name: 'x'.repeat(61) }, 'not json']) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await files()).toEqual(before);
  });

  it('keeps the company folder valid when a name has characters that mean something in YAML', async () => {
    const r = await post({ name: 'R&D: "Lab" #1 {x}' });
    expect(r.status).toBe(201);
    const { key } = (await r.json()) as { key: string };
    expect(key).toMatch(/^[a-z0-9-]+$/);
    const dept = (await loadCompany(root)).departments.find((d) => d.key === key)!;
    expect(dept.name).toBe('R&D: "Lab" #1 {x}');
    expect((await office()).map.rooms.some((x) => x.name === 'R&D: "Lab" #1 {x}')).toBe(true);
  });

  it('gives each department its own room when several are added at once', async () => {
    const results = await Promise.all(['Alpha', 'Beta', 'Gamma'].map((name) => post({ name })));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    const rooms = (await office()).map.rooms.filter((r) => ['Alpha', 'Beta', 'Gamma'].includes(r.name));
    expect(rooms).toHaveLength(3);
    const numbers = (await loadCompany(root)).departments.map((d) => d.room);
    expect(new Set(numbers).size).toBe(numbers.length); // no two departments share a room number
  });

  it('says so when the office has no room left, and changes nothing', async () => {
    let last = 201;
    for (let n = 0; n < 12 && last === 201; n++) last = (await post({ name: `Filler ${n}` })).status;
    expect(last).toBe(409);
    const before = await files();
    const r = await post({ name: 'One Too Many' });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toMatch(/no room/i);
    expect(await files()).toEqual(before);
    expect((await sql("select 1 from departments where key = 'one-too-many'")).rows).toHaveLength(0);
  });
});
