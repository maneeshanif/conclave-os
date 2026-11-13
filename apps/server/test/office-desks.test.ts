import { rm } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { loadCompany } from '../src/company/loader';
import { syncCompany } from '../src/company/sync';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { assignDesks, loadOffice } from '../src/office/desks';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

let sys: System;
let app: ReturnType<typeof createApp>;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
/** Retiring an agent is taking its role file out of the company folder; the next sync retires it. */
const retire = async (id: string, department: string) => {
  await rm(path.join(sys.companyRoot, 'departments', department, 'agents', id), { recursive: true, force: true });
  await syncCompany(sys.app, ws(), await loadCompany(sys.companyRoot));
};
const hire = (id: string, department = 'outreach') => agentNew(sys, { template: 'researcher', department, id });
const assign = async () => {
  const office = await loadOffice(sys.companyRoot);
  return withWorkspace(sys.app, ws(), ({ client }) => assignDesks(client, ws(), office.map));
};
const desks = async () => (await sql('select a.key, d.room, d.slot from office_desks d join agents a on a.id = d.agent_id order by d.room, d.slot nulls last, a.key')).rows as { key: string; room: string; slot: number | null }[];
const deskOf = async (key: string) => (await desks()).find((d) => d.key === key);

beforeAll(async () => {
  ({ sys } = await testSystem());
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), companyRoot: sys.companyRoot });
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  // A clean office: no desks, no agents, and no role files that would bring the old ones back at the next sync.
  await rm(path.join(sys.companyRoot, 'departments'), { recursive: true, force: true });
  await sql('delete from office_desks');
  await sql('delete from agents');
});

describe('desks (S6-2)', () => {
  it('gives each new hire the next free desk in its department\'s room, in the order they were hired', async () => {
    for (const id of ['d-one', 'd-two', 'd-three']) {
      await hire(id);
      await assign();
    }
    expect((await desks()).filter((d) => d.room === 'Outreach')).toEqual([
      { key: 'd-one', room: 'Outreach', slot: 1 },
      { key: 'd-two', room: 'Outreach', slot: 2 },
      { key: 'd-three', room: 'Outreach', slot: 3 },
    ]);
  });

  it('seats several hires made before the next assignment in hire order, not at random', async () => {
    for (const id of ['e-one', 'e-two', 'e-three']) await hire(id, 'lead-gen');
    await assign();
    expect((await desks()).filter((d) => d.room === 'Lead Gen').map((d) => [d.key, d.slot])).toEqual([['e-one', 1], ['e-two', 2], ['e-three', 3]]);
  });

  it('frees a retired agent\'s desk for the next hire, and moves nobody else', async () => {
    for (const id of ['f-one', 'f-two', 'f-three']) await hire(id, 'research');
    await assign();
    await retire('f-two', 'research');
    await assign();
    expect(await deskOf('f-two')).toBeUndefined();
    expect(await deskOf('f-one')).toMatchObject({ slot: 1 });
    expect(await deskOf('f-three')).toMatchObject({ slot: 3 }); // did not shuffle up
    await hire('f-four', 'research');
    await assign();
    expect(await deskOf('f-four')).toMatchObject({ room: 'Research', slot: 2 }); // the freed desk
  });

  it('puts the overflow in the lounge when the room is full, with no desk number', async () => {
    for (let i = 1; i <= 5; i++) await hire(`g-${i}`, 'chief-of-staff');
    await assign();
    const all = await desks();
    expect(all.filter((d) => d.room === 'Chief of Staff').map((d) => d.slot)).toEqual([1, 2, 3, 4]);
    expect(all.find((d) => d.key === 'g-5')).toMatchObject({ room: 'Lounge', slot: null });
  });

  it('puts an agent whose department has no room yet in the lounge', async () => {
    await hire('h-one', 'marketing'); // an inactive department with no room drawn
    await assign();
    expect(await deskOf('h-one')).toMatchObject({ room: 'Lounge', slot: null });
  });

  it('moves an agent to its new department\'s room when its department changes, and to nothing else', async () => {
    await hire('i-one', 'outreach');
    await hire('i-two', 'outreach');
    await assign();
    await sql("update agents set department_id = (select id from departments where key = 'research') where key = 'i-two'");
    await assign();
    expect(await deskOf('i-two')).toMatchObject({ room: 'Research', slot: 1 });
    expect(await deskOf('i-one')).toMatchObject({ room: 'Outreach', slot: 1 });
  });

  it('never gives one desk to two agents, even when asked to assign at the same time', async () => {
    for (const id of ['j-1', 'j-2', 'j-3', 'j-4']) await hire(id, 'lead-gen');
    await Promise.all([assign(), assign(), assign(), assign(), assign()]);
    const taken = (await desks()).filter((d) => d.slot !== null).map((d) => `${d.room}:${d.slot}`);
    expect(new Set(taken).size).toBe(taken.length);
    expect(taken).toHaveLength(4);
  });

  it('is the same when run again: nobody moves', async () => {
    await hire('k-one');
    await hire('k-two');
    await assign();
    const before = await desks();
    await assign();
    expect(await desks()).toEqual(before);
  });
});

describe('the office API (S6-2)', () => {
  it('gives the rooms, desks, objects and entries from the map, and each agent\'s room and desk', async () => {
    await hire('l-one', 'outreach');
    const res = await app.request('/api/office');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { map: { width: number; rooms: { name: string }[]; desks: unknown[]; objects: { type: string }[]; entries: { name: string }[]; walls: string[] }; agents: { key: string; department: string; room: string; desk: number | null }[] };
    expect(body.map.rooms.map((r) => r.name)).toEqual(expect.arrayContaining(['Outreach', 'Boardroom', 'Lounge', 'Hall']));
    expect(body.map.objects.some((o) => o.type === 'approvals-desk')).toBe(true);
    expect(body.map.entries.some((e) => e.name === 'door')).toBe(true);
    expect(body.map.walls).toHaveLength(24);
    expect(body.map.walls[0]).toHaveLength(body.map.width);
    expect(body.agents.find((a) => a.key === 'l-one')).toMatchObject({ department: 'outreach', room: 'Outreach', desk: 1 });
    await sql("update agents set status = 'retired' where key = 'l-one'");
    const after = (await (await app.request('/api/office')).json()) as { agents: { key: string }[] };
    expect(after.agents.some((a) => a.key === 'l-one')).toBe(false); // retired agents are not in the office
  });

  it('serves the Tiled map itself, for the drawing', async () => {
    const res = await app.request('/api/office/map');
    expect(res.status).toBe(200);
    const j = (await res.json()) as { tilewidth: number; layers: { name: string }[] };
    expect(j.tilewidth).toBe(32);
    expect(j.layers.map((l) => l.name)).toEqual(['floor', 'collision', 'rooms', 'desks', 'objects', 'entries']);
  });
});
