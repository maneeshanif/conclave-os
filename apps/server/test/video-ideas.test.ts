import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { classifyIdea } from '../src/video/ideas';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

let sys: System;
let app: ReturnType<typeof createApp>;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const json = { 'content-type': 'application/json' };
const send = (method: string, p: string, body?: unknown) => app.request(`/api${p}`, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) });
type Idea = { id: string; idea: string; kind: string; url: string | null; source: string; stage: string; hookId: string | null; createdAt: string };
const add = async (body: unknown) => {
  const res = await send('POST', '/video-ideas', body);
  return { res, body: (await res.json()) as Idea & { error?: string } };
};

beforeAll(async () => {
  ({ sys } = await testSystem());
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('delete from video_ideas');
  await sql('delete from hooks');
});

describe('telling a line from a link from a voice note (S5-7)', () => {
  it('calls a lone web address a link, long spoken text a voice note, and anything else a line', () => {
    expect(classifyIdea('https://youtube.test/watch?v=1')).toMatchObject({ kind: 'link', url: 'https://youtube.test/watch?v=1' });
    expect(classifyIdea('  https://x.test/post  ')).toMatchObject({ kind: 'link' });
    expect(classifyIdea('Show how a clinic booking page loses people at step two')).toMatchObject({ kind: 'line', url: null });
    expect(classifyIdea('Look at https://x.test/a and make something like it')).toMatchObject({ kind: 'line', url: null });
    expect(classifyIdea('um so I was thinking '.repeat(30), 'voice')).toMatchObject({ kind: 'voice' });
  });
});

describe('the Video Ideas API (S5-7)', () => {
  it('adds a line from the founder in stage idea', async () => {
    const { res, body } = await add({ idea: 'A 30 second clip of a booking page losing a patient at step two' });
    expect(res.status).toBe(201);
    expect(body).toMatchObject({ kind: 'line', source: 'founder', stage: 'idea', url: null, hookId: null });
  });

  it('stores a link as a link, with its address', async () => {
    const { body } = await add({ idea: 'https://youtube.test/watch?v=abc' });
    expect(body).toMatchObject({ kind: 'link', url: 'https://youtube.test/watch?v=abc' });
  });

  it('keeps a voice note as its transcript, labelled as one', async () => {
    const { body } = await add({ idea: 'So the idea is that we show the phone first problem on a real clinic site', kind: 'voice' });
    expect(body.kind).toBe('voice');
  });

  it('refuses an empty idea, one that is far too long, an unknown kind, and a source set from outside', async () => {
    expect((await add({ idea: '   ' })).res.status).toBe(400);
    expect((await add({ idea: 'x'.repeat(5001) })).res.status).toBe(400);
    expect((await add({ idea: 'ok', kind: 'poem' })).res.status).toBe(400);
    expect((await add({ idea: 'ok', source: 'hook_scout' })).res.status).toBe(400);
  });

  it('lists the newest first, only ideas by default, and by stage on request', async () => {
    const a = await add({ idea: 'first' });
    await new Promise((r) => setTimeout(r, 15));
    const b = await add({ idea: 'second' });
    await send('POST', `/video-ideas/${a.body.id}/shelve`);
    const live = (await (await send('GET', '/video-ideas')).json()) as Idea[];
    expect(live.map((i) => i.idea)).toEqual(['second']);
    expect(((await (await send('GET', '/video-ideas?stage=shelved')).json()) as Idea[]).map((i) => i.id)).toEqual([a.body.id]);
    expect(((await (await send('GET', '/video-ideas?stage=all')).json()) as Idea[]).map((i) => i.idea)).toEqual(['second', 'first']);
    expect((await send('GET', '/video-ideas?stage=nonsense')).status).toBe(400);
    void b;
  });

  it('shelves and brings back an idea, and turns one into a brief only from stage idea', async () => {
    const { body } = await add({ idea: 'something' });
    expect(((await (await send('POST', `/video-ideas/${body.id}/shelve`)).json()) as Idea).stage).toBe('shelved');
    expect((await send('POST', `/video-ideas/${body.id}/brief`)).status).toBe(409); // shelved: bring it back first
    expect(((await (await send('POST', `/video-ideas/${body.id}/unshelve`)).json()) as Idea).stage).toBe('idea');
    expect(((await (await send('POST', `/video-ideas/${body.id}/brief`)).json()) as Idea).stage).toBe('brief');
    expect((await send('POST', `/video-ideas/${body.id}/shelve`)).status).toBe(409); // already a brief: it moves on, it is not shelved
  });

  it('404s for an idea that is not there, and audits what a person does', async () => {
    expect((await send('POST', `/video-ideas/${randomUUID()}/shelve`)).status).toBe(404);
    expect((await send('GET', '/video-ideas/not-an-id')).status).toBe(404);
    const { body } = await add({ idea: 'audited' });
    await send('POST', `/video-ideas/${body.id}/shelve`);
    expect((await sql("select action from audit_log where subject = $1 order by id", [body.id])).rows.map((r) => r.action)).toEqual(['video_idea.added', 'video_idea.shelved']);
  });

  it('links an idea to the hook it came from when the scout files one', async () => {
    const hook = (await sql("insert into hooks (workspace_id, pattern, example_url, found_by) values ($1, 'A pattern', 'https://x.test/h1', 'agent:hook-scout') returning id", [ws()])).rows[0].id as string;
    const { res, body } = await add({ idea: 'Use that pattern for the booking page story', hookId: hook });
    expect(res.status).toBe(201);
    expect(body.hookId).toBe(hook);
    expect((await add({ idea: 'bad hook', hookId: randomUUID() })).res.status).toBe(404);
  });
});
