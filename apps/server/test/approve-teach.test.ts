import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { lessonFromEdit } from '../src/memory/lessons';
import { memoryBlock } from '../src/memory/memory';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

/** Approve and teach (S8-2): an edit before approving changes what the next run is told. */
let sys: System;
let app: ReturnType<typeof createApp>;
let agentId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const decide = (id: string, body: unknown) => app.request(`/api/approvals/${id}/decide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function draft(body: string) {
  const email = `x-${randomUUID().slice(0, 8)}@clinic.test`;
  const lead = (await sql("insert into leads (workspace_id, business_name, email) values ($1, 'Glow Clinic', $2) returning id", [ws(), email])).rows[0].id as string;
  const payload = { leadId: lead, to: email, subject: 'Booking page', body, step: 1 };
  const id = (await sql("insert into approvals (workspace_id, kind, dedupe_key, agent_id, payload) values ($1, 'email.send', $2, $3, $4) returning id", [ws(), `t:${randomUUID()}`, agentId, JSON.stringify(payload)])).rows[0].id as string;
  await sql("insert into outreach_messages (workspace_id, lead_id, approval_id, to_address, subject, body, status) values ($1, $2, $3, $4, 's', 'b', 'queued')", [ws(), lead, id, email]);
  return id;
}

beforeAll(async () => {
  ({ sys } = await testSystem());
  await agentNew(sys, { template: 'outreach-rep', department: 'outreach', id: 'teach-rep', name: 'Rep' });
  agentId = (await sql("select id from agents where key = 'teach-rep'")).rows[0].id;
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
}, 240_000);
afterAll(() => sys?.close());

describe('approve and teach (S8-2)', () => {
  it('saves nothing when a draft is approved as it is', async () => {
    const id = await draft('Hi, I saw your booking page.');
    expect((await decide(id, { approved: true })).status).toBe(200);
    expect((await sql('select count(*)::int as n from memories where agent_id = $1', [agentId])).rows[0].n).toBe(0);
  });

  it('turns an edit into a founder lesson for that agent, which the next run for a matching task is given', async () => {
    const id = await draft('Dear Sir or Madam, we are a leading agency offering world class solutions.');
    expect((await decide(id, { approved: true, editedPayload: { subject: 'Booking page', body: 'Hi Dana, your booking page asks for a phone call first. Want a faster one?' } })).status).toBe(200);
    const m = (await sql('select scope, source, text from memories where agent_id = $1', [agentId])).rows;
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ scope: 'founder', source: `approval:${id}` });
    expect(m[0].text).toMatch(/leading agency/);
    expect(m[0].text).toMatch(/faster one/);
    expect(await memoryBlock(sys.app, ws(), agentId, 'Write an email about the booking page for a clinic')).toMatch(/faster one/);
  });

  it('teaches nothing on a rejection or an edit that changed nothing', async () => {
    const before = Number((await sql('select count(*)::int as n from memories')).rows[0].n);
    const a = await draft('Same text.');
    await decide(a, { approved: true, editedPayload: { subject: 'Booking page', body: 'Same text.' } });
    const b = await draft('Rejected text.');
    await decide(b, { approved: false, editedPayload: { subject: 's', body: 'Another text.' } });
    expect(Number((await sql('select count(*)::int as n from memories')).rows[0].n)).toBe(before);
    expect(lessonFromEdit('video.brief', { a: 1 }, { a: 2 })).toBeNull();
  });
});
