import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus, type BusMessage } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { attachOfficeEvents } from '../src/office/live';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';
import { rm } from 'node:fs/promises';
import path from 'node:path';

let sys: System;
let app: ReturnType<typeof createApp>;
const ids: Record<string, string> = {};
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
type Place = { agentId: string; key: string; place: string; reason: string; x: number; y: number };
const state = async () => ((await (await app.request('/api/office/state')).json()) as { places: Place[] }).places;
const placeOf = async (key: string) => (await state()).find((p) => p.key === key)!;

beforeAll(async () => {
  ({ sys } = await testSystem());
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), companyRoot: sys.companyRoot });
  await rm(path.join(sys.companyRoot, 'departments'), { recursive: true, force: true });
  for (const k of ['p-work', 'p-wait', 'p-idle', 'p-both']) {
    await agentNew(sys, { template: 'researcher', department: 'outreach', id: k });
    ids[k] = (await sql('select id from agents where key = $1', [k])).rows[0].id;
  }
}, 240_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('delete from approvals');
  await sql('delete from run_events');
  await sql('delete from runs');
});
const run = (agent: string, status: string) => sql("insert into runs (workspace_id, agent_id, trigger, runtime, status, started_at) values ($1, $2, 'manual', 'claude-cli', $3, now())", [ws(), ids[agent], status]);
const approval = (agent: string, status = 'pending') => sql("insert into approvals (workspace_id, kind, dedupe_key, agent_id, payload, status) values ($1, 'email.send', $2, $3, '{}', $4)", [ws(), `k-${Math.random()}`, ids[agent], status]);

describe('where each agent is, from the data (S6-3)', () => {
  it('puts an idle agent in the lounge', async () => {
    expect(await placeOf('p-idle')).toMatchObject({ place: 'lounge', reason: 'Idle.' });
  });

  it('puts an agent with a run going at its desk, on the desk\'s tile', async () => {
    await run('p-work', 'running');
    const p = await placeOf('p-work');
    expect(p.place).toBe('desk');
    const office = (await (await app.request('/api/office')).json()) as { map: { desks: { room: string; slot: number; x: number; y: number }[] }; agents: { key: string; room: string; desk: number }[] };
    const me = office.agents.find((a) => a.key === 'p-work')!;
    const desk = office.map.desks.find((d) => d.room === me.room && d.slot === me.desk)!;
    expect([p.x, p.y]).toEqual([desk.x, desk.y]);
  });

  it('counts a run that is queued as work, and one that finished as nothing', async () => {
    await run('p-work', 'queued');
    expect((await placeOf('p-work')).place).toBe('desk');
    await sql("update runs set status = 'succeeded'");
    expect((await placeOf('p-work')).place).toBe('lounge');
  });

  it('puts an agent at the approvals desk while something it proposed is pending, and back when it is decided', async () => {
    await approval('p-wait');
    expect(await placeOf('p-wait')).toMatchObject({ place: 'approvals', reason: 'Waiting for you to decide.' });
    await sql("update approvals set status = 'approved'");
    expect((await placeOf('p-wait')).place).toBe('lounge');
  });

  it('counts a run that is waiting for an approval as waiting for you', async () => {
    await run('p-wait', 'waiting_approval');
    expect((await placeOf('p-wait')).place).toBe('approvals');
  });

  it('goes to the stronger reason: working beats waiting', async () => {
    await run('p-both', 'running');
    await approval('p-both');
    expect((await placeOf('p-both')).place).toBe('desk');
  });

  it('gives every active agent a place, and none to a retired one', async () => {
    expect((await state()).map((p) => p.key).sort()).toEqual(['p-both', 'p-idle', 'p-wait', 'p-work']);
    await sql("update agents set status = 'retired' where key = 'p-idle'");
    expect((await state()).some((p) => p.key === 'p-idle')).toBe(false);
  });

  it('is 422 with the reader\'s message when the map is broken', async () => {
    const broken = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), companyRoot: path.join(sys.companyRoot, 'nowhere') });
    expect((await broken.request('/api/office/state')).status).toBe(422);
  });
});

describe('the live message (S6-3)', () => {
  const ws0 = 'w';
  const kinds = (send: BusMessage[]) => {
    const bus = new Bus();
    const out: string[] = [];
    bus.subscribe((m) => out.push(m.kind));
    const off = attachOfficeEvents(bus);
    for (const m of send) bus.publish(m);
    off();
    return out.filter((k) => k === 'office.changed').length;
  };

  it('fires when a run starts or ends, an approval is queued or decided, and a discussion opens or closes', () => {
    expect(kinds([{ kind: 'run.state', workspaceId: ws0, runId: 'r', taskId: null, status: 'running' }])).toBe(1);
    expect(kinds([{ kind: 'run.state', workspaceId: ws0, runId: 'r', taskId: null, status: 'succeeded' }])).toBe(1);
    expect(kinds([{ kind: 'approval.changed', workspaceId: ws0, approvalId: 'a', status: 'pending' }])).toBe(1);
    expect(kinds([{ kind: 'approval.changed', workspaceId: ws0, approvalId: 'a', status: 'approved' }])).toBe(1);
    expect(kinds([{ kind: 'discussion.changed', workspaceId: ws0, discussionId: 'd' }])).toBe(1);
  });

  it('does not fire for what does not move anyone: a task edit, a setting, an action item, a run event', () => {
    expect(
      kinds([
        { kind: 'task.changed', workspaceId: ws0, taskId: 't' },
        { kind: 'settings.changed', workspaceId: ws0 },
        { kind: 'action_item.changed', workspaceId: ws0, itemId: 'i' },
        { kind: 'run.event', workspaceId: ws0, runId: 'r', taskId: null, seq: 1, event: { type: 'message', text: 'x' } },
      ]),
    ).toBe(0);
  });

  it('carries the workspace and nothing else, and does not echo its own message', () => {
    const bus = new Bus();
    const seen: BusMessage[] = [];
    bus.subscribe((m) => seen.push(m));
    attachOfficeEvents(bus);
    bus.publish({ kind: 'run.state', workspaceId: ws0, runId: 'r', taskId: null, status: 'running' });
    const changed = seen.filter((m) => m.kind === 'office.changed');
    expect(changed).toEqual([{ kind: 'office.changed', workspaceId: ws0 }]);
    expect(seen).toHaveLength(2); // the run message and one office.changed: it did not loop
  });
});
