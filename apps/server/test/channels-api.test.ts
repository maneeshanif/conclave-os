import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { receiveChannelMessage } from '../src/channels/inbound';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

/** The Channels list (S10-7): exactly what the tables hold, and where each answer stands. */
let sys: System;
let app: ReturnType<typeof createApp>;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));

beforeAll(async () => {
  ({ sys } = await testSystem());
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
}, 240_000);
afterAll(() => sys?.close());

describe('GET /api/channels (S10-7)', () => {
  it('is empty at first, then matches the table, newest first, with the state of each reply', async () => {
    expect(await (await app.request('/api/channels')).json()).toEqual({ messages: [] });
    const a = await receiveChannelMessage(sys.app, ws(), { channel: 'slack', externalId: 'a', from: 'dana', body: 'First.' });
    const b = await receiveChannelMessage(sys.app, ws(), { channel: 'jira', externalId: 'b', from: 'client', body: 'Second.' });
    await sql("update channel_messages set created_at = now() - interval '1 hour' where id = $1", [a.messageId]);
    await sql("insert into approvals (workspace_id, kind, dedupe_key, payload, status) values ($1, 'channel.reply', $2, '{}', 'pending')", [ws(), `channel:${b.messageId}`]);
    const list = ((await (await app.request('/api/channels')).json()) as { messages: { id: string; channel: string; from: string; body: string; reply: string | null; status: string }[] }).messages;
    expect(list.map((m) => m.id)).toEqual([b.messageId, a.messageId]);
    expect(list[0]).toMatchObject({ channel: 'jira', from: 'client', body: 'Second.', reply: 'pending', status: 'new' });
    expect(list[1]).toMatchObject({ channel: 'slack', reply: null });
    expect(list).toHaveLength(Number((await sql('select count(*)::int as n from channel_messages')).rows[0].n));
  });
});
