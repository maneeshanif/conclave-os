import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createExecutors, type Executors } from '../src/actions';
import { outboxChannelConnector } from '../src/actions/channel-connector';
import { OutboxTransport } from '../src/actions/transport';
import { receiveChannelMessage } from '../src/channels/inbound';
import { agentNew } from '../src/commands/agent-new';
import { LocalCrmConnector, syncFromCrm } from '../src/crm/sync';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool } from '../src/harness/os-tools';
import { closeMeeting, LocalMeetingConnector, openMeeting } from '../src/meetings/connector';
import { guestRoutes, openGuestLink } from '../src/meetings/guest';
import { giveConsent, joinMeeting } from '../src/meetings/notes';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

/**
 * Slice 10, end to end (S10-9, SPEC 18 row 10): a client joins from a guest link, you walk in from the office, the notes and action items land
 * on the deal, and a Slack reply from a client becomes a drafted answer that waits for your yes. Rooms and replies are local stand-ins: nothing
 * is dialled, posted or sent, and no link or key is stored.
 */
let sys: System;
let executors: Executors;
let store: DbOsStore;
let outbox = '';
let agentId = '';
let runId = '';
let dealId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const scope = () => ({ workspaceId: ws(), agentId, runId });
const approve = (id: string) => sql("update approvals set status = 'approved', decided_by = 'founder', decided_at = now() where id = $1", [id]);

beforeAll(async () => {
  ({ sys } = await testSystem());
  outbox = await mkdtemp(path.join(tmpdir(), 'conclave-s10-'));
  executors = createExecutors({ pool: sys.app, workspaceId: ws(), transport: new OutboxTransport(path.join(outbox, 'mail')), companyRoot: sys.companyRoot, from: 'hello@example.test', dataDir: outbox, channelConnector: outboxChannelConnector(outbox) });
  await agentNew(sys, { template: 'client-success', department: 'outreach', id: 's10-cs', name: 'Casey' });
  agentId = (await sql("select id from agents where key = 's10-cs'")).rows[0].id;
  await sql('update agents set autonomy = 2 where id = $1', [agentId]);
  runId = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status) values ($1, $2, 'task', 'claude-cli', 'running') returning id", [ws(), agentId])).rows[0].id;
  store = new DbOsStore(sys.app, () => undefined, sys.companyRoot);
  const account = (await sql("insert into accounts (workspace_id, name, stage) values ($1, 'Glow Clinic', 'client') returning id", [ws()])).rows[0].id as string;
  dealId = (await sql('insert into deals (workspace_id, account_id) values ($1, $2) returning id', [ws(), account])).rows[0].id as string;
}, 240_000);
afterAll(async () => {
  await sys?.close();
  if (outbox) await rm(outbox, { recursive: true, force: true });
});

describe('slice 10: client meetings and channels (S10-9)', () => {
  let meetingId = '';

  it('a client gets a guest link only after you approve it, and opens it with no account', async () => {
    meetingId = (await sql("insert into meetings (workspace_id, deal_id, title, starts_at) values ($1, $2, 'Kickoff with Glow Clinic', now() + interval '1 hour') returning id", [ws(), dealId])).rows[0].id as string;
    expect(await callOsTool(store, scope(), 'propose_meeting', { meetingId, to: 'dana@glow.test' })).toMatch(/Nothing has been sent/);
    const a = (await sql("select id from approvals where kind = 'meeting.invite'")).rows[0].id as string;
    expect((await sql('select count(*)::int as n from guest_links')).rows[0].n).toBe(0);
    await approve(a);
    expect((await executors.run(a)).status).toBe('executed');
    const file = (await readdir(path.join(outbox, 'invites')))[0]!;
    const { url } = JSON.parse(await readFile(path.join(outbox, 'invites', file), 'utf8')) as { url: string };
    const token = url.split('/meet/')[1]!;
    const res = await guestRoutes({ pool: sys.app }).request(`/${token}`);
    expect(await res.json()).toMatchObject({ title: 'Kickoff with Glow Clinic' });
    expect(JSON.stringify((await sql('select * from guest_links')).rows)).not.toContain(token.split('.')[1]);
  });

  it('you walk in: the room opens, everyone agrees to notes, and the Note Taker writes them down', async () => {
    const connector = new LocalMeetingConnector();
    expect((await openMeeting(sys.app, ws(), connector, meetingId)).already).toBe(false);
    await joinMeeting(sys.app, ws(), meetingId, 'Dana (guest)');
    await joinMeeting(sys.app, ws(), meetingId, 'Anees');
    await expect(callOsTool(store, scope(), 'add_meeting_note', { meetingId, text: 'Too soon.' })).rejects.toThrow(/consent/i);
    await giveConsent(sys.app, ws(), meetingId, 'Dana (guest)');
    await giveConsent(sys.app, ws(), meetingId, 'Anees');
    await callOsTool(store, scope(), 'add_meeting_note', { meetingId, text: 'Dana wants a faster booking page by January.', actionItems: ['Send three examples', 'Book the design review'] });
    expect(await closeMeeting(sys.app, ws(), connector, meetingId)).toEqual({ closed: true });
  });

  it('the notes and action items are on the deal, once, and the link no longer opens', async () => {
    const rows = (await sql("select title, kind, status from tasks where subject_type = 'deal' and subject_id = $1 order by kind, title", [dealId])).rows;
    expect(rows).toEqual([
      { title: 'Book the design review', kind: 'meeting_action', status: 'todo' },
      { title: 'Send three examples', kind: 'meeting_action', status: 'todo' },
      { title: 'Notes: Kickoff with Glow Clinic', kind: 'meeting_notes', status: 'done' },
    ]);
    const file = (await readdir(path.join(outbox, 'invites')))[0]!;
    const { url } = JSON.parse(await readFile(path.join(outbox, 'invites', file), 'utf8')) as { url: string };
    expect(await openGuestLink(sys.app, url.split('/meet/')[1]!)).toBeNull();
  });

  it('a Slack message from the client becomes a drafted reply that waits for your yes, and goes out once after it', async () => {
    const r = await receiveChannelMessage(sys.app, ws(), { channel: 'slack', externalId: 'C9.1', from: 'dana@glow', body: 'Thanks for today. Can you send the examples by Friday?' });
    await callOsTool(store, scope(), 'propose_channel_reply', { messageId: r.messageId, text: 'Thanks Dana. I will send the three examples by Friday.' });
    const a = (await sql("select id, status from approvals where kind = 'channel.reply'")).rows[0];
    expect(a.status).toBe('pending');
    await expect(readdir(path.join(outbox, 'channels'))).rejects.toThrow();
    await approve(a.id);
    expect((await executors.run(a.id)).status).toBe('executed');
    expect((await executors.run(a.id)).status).toBe('already_claimed');
    expect(await readdir(path.join(outbox, 'channels'))).toHaveLength(1);
  });

  it('an outside CRM that disagrees about the client does not change the tables, and is flagged', async () => {
    const r = await syncFromCrm(sys.app, ws(), new LocalCrmConnector([{ externalId: 'sf-77', name: 'Glow Clinic', stage: 'lost' }]));
    expect(r).toMatchObject({ matched: 1, conflicts: 1 });
    expect((await sql("select stage from accounts where name = 'Glow Clinic'")).rows[0].stage).toBe('client');
  });
});
