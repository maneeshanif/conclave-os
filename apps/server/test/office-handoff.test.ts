import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus, type BusMessage } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool, MemoryOsStore } from '../src/harness/os-tools';
import { attachOfficeEvents } from '../src/office/live';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';
import { rm } from 'node:fs/promises';
import path from 'node:path';

let sys: System;
let app: ReturnType<typeof createApp>;
let bus: Bus;
const ids: Record<string, string> = {};
const seen: BusMessage[] = [];
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
type Place = { agentId: string; key: string; place: string; reason: string; x: number; y: number };
const state = async () => ((await (await app.request('/api/office/state')).json()) as { places: Place[] }).places;
const placeOf = async (key: string) => (await state()).find((p) => p.key === key)!;
/** Where an agent's desk is: the tile the visitor should be next to. */
const deskOf = async (key: string) => {
  const o = (await (await app.request('/api/office')).json()) as { map: { desks: { room: string; slot: number; x: number; y: number }[] }; agents: { key: string; room: string | null; desk: number | null }[] };
  const a = o.agents.find((x) => x.key === key)!;
  return o.map.desks.find((d) => d.room === a.room && d.slot === a.desk)!;
};
const gap = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
const say = (from: string, to: string | null, ageSeconds = 0) =>
  sql("insert into messages (workspace_id, from_id, to_id, body, created_at) values ($1, $2, $3, 'over to you', now() - make_interval(secs => $4))", [ws(), from, to, ageSeconds]);

beforeAll(async () => {
  ({ sys } = await testSystem());
  await rm(path.join(sys.companyRoot, 'departments'), { recursive: true, force: true });
  // Four desks in Outreach, so the fifth agent sits in the lounge.
  for (const k of ['hf-a', 'hf-b', 'hf-c', 'hf-d', 'hf-e']) {
    await agentNew(sys, { template: 'researcher', department: 'outreach', id: k });
    ids[k] = (await sql('select id from agents where key = $1', [k])).rows[0].id;
  }
  for (const k of Object.keys(ids)) await sql('update agents set autonomy = 1 where id = $1', [ids[k]]);
  bus = new Bus();
  bus.subscribe((m) => seen.push(m));
  attachOfficeEvents(bus);
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus, dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), companyRoot: sys.companyRoot });
}, 240_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('delete from messages');
  await sql('delete from tasks');
  seen.length = 0;
});

describe('a handoff shows as walking to the colleague (S6-13d2)', () => {
  it('puts the giver beside the receiver\'s desk, with the reason, right after the handoff', async () => {
    await say('agent:hf-a', 'agent:hf-b');
    const a = await placeOf('hf-a');
    const b = await placeOf('hf-b');
    expect(a.place).toBe('handoff');
    expect(a.reason).toMatch(/handing a task to /i);
    expect(gap(a, await deskOf('hf-b'))).toBe(1);
    expect(b.place).not.toBe('handoff');
  });

  it('puts the giver back where it was once the half minute is over', async () => {
    await say('agent:hf-a', 'agent:hf-b', 31);
    expect((await placeOf('hf-a')).place).not.toBe('handoff');
  });

  it('uses the latest handoff of an agent, and two givers visiting the same desk stand on different tiles', async () => {
    await say('agent:hf-a', 'agent:hf-c', 20);
    await say('agent:hf-a', 'agent:hf-b', 2);
    await say('agent:hf-d', 'agent:hf-b', 1);
    const [a, d] = await Promise.all([placeOf('hf-a'), placeOf('hf-d')]);
    expect(a.place).toBe('handoff');
    expect(d.place).toBe('handoff');
    expect(`${a.x},${a.y}`).not.toBe(`${d.x},${d.y}`);
    expect(gap(a, await deskOf('hf-b'))).toBe(1); // the later one is the one that counts, not the earlier one to hf-c
  });

  it('shows nothing for a message to the founder, a note with no one to, or a handoff to an agent that has no desk', async () => {
    await say('agent:hf-a', 'founder');
    await say('agent:hf-b', null);
    await say('agent:hf-c', 'agent:hf-e'); // hf-e is in the lounge
    await say('agent:hf-d', 'agent:nobody-here');
    for (const k of ['hf-a', 'hf-b', 'hf-c', 'hf-d']) expect((await placeOf(k)).place, k).not.toBe('handoff');
  });

  it('is what the hand_off_task tool does: after it, the giver is beside the receiver', async () => {
    const store = new DbOsStore(sys.app, (_w, t) => bus.publish({ kind: 'task.changed', workspaceId: ws(), taskId: t }), sys.companyRoot, undefined, (w) => bus.publish({ kind: 'office.changed', workspaceId: w }));
    const task = (await sql("insert into tasks (workspace_id, title, status, assignee_id, locked_by, created_by) values ($1, 'Send it', 'in_progress', $2, $2, 'founder') returning id", [ws(), ids['hf-a']])).rows[0].id;
    seen.length = 0;
    await callOsTool(store, { workspaceId: ws(), agentId: ids['hf-a']!, runId: '00000000-0000-4000-8000-000000000000', taskId: task }, 'hand_off_task', { to: 'hf-b', note: 'Please send it.' });
    expect((await placeOf('hf-a')).place).toBe('handoff');
    expect(seen.some((m) => m.kind === 'office.changed')).toBe(true); // the office is told, so the picture moves at once
  });
});
