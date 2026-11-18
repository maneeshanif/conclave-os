import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

/** The setup wizard (S9-7): each step is recorded, can be answered again, and nothing is sent or taken that is secret. */
let sys: System;
let app: ReturnType<typeof createApp>;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const put = (step: string, body: unknown) => app.request(`/api/setup/${step}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const state = async () => (await (await app.request('/api/setup')).json()) as { steps: { step: string; done: boolean; data: unknown }[]; next: string | null; templates: string[] };

beforeAll(async () => {
  ({ sys } = await testSystem());
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), templatesRoot: sys.templatesRoot });
}, 240_000);
afterAll(() => sys?.close());

describe('the setup wizard (S9-7)', () => {
  it('starts at the first step with the templates on offer, and lists five steps in order', async () => {
    const s = await state();
    expect(s.steps.map((x) => x.step)).toEqual(['company', 'template', 'model', 'channels', 'first-hire']);
    expect(s.steps.every((x) => !x.done)).toBe(true);
    expect(s.next).toBe('company');
    expect(s.templates).toEqual(expect.arrayContaining(['starter', 'saas-founder', 'course-creator']));
  });

  it('records each answer, moves to the next step, and can be answered again', async () => {
    expect((await put('company', { name: 'Acme Courses' })).status).toBe(200);
    expect((await state()).next).toBe('template');
    expect((await put('template', { template: 'course-creator' })).status).toBe(200);
    expect((await put('model', { source: 'local', runtime: 'openai-agents' })).status).toBe(200);
    expect((await put('channels', { later: ['email', 'linkedin'] })).status).toBe(200);
    expect((await put('first-hire', { template: 'writer', department: 'outreach', name: 'Wren' })).status).toBe(200);
    const done = await state();
    expect(done.next).toBeNull();
    expect(done.steps.every((x) => x.done)).toBe(true);
    await put('company', { name: 'Acme Online Courses' });
    expect((await state()).steps[0]!.data).toEqual({ name: 'Acme Online Courses' });
    expect((await sql('select count(*)::int as n from setup_steps')).rows[0].n).toBe(5);
  });

  it('refuses a template that is not there, an unknown step, a bad answer, and any field that is not part of the step', async () => {
    expect((await put('template', { template: 'no-such-template' })).status).toBe(400);
    expect((await put('nonsense', {})).status).toBe(404);
    expect((await put('company', { name: '' })).status).toBe(400);
    expect((await put('model', { source: 'magic' })).status).toBe(400);
    expect((await put('channels', { later: ['telegram'] })).status).toBe(400);
  });

  it('never takes a key: a model answer with an apiKey, a token or a secret in it is refused, and nothing is stored', async () => {
    const before = JSON.stringify((await sql('select data from setup_steps order by step')).rows);
    for (const extra of [{ apiKey: 'sk-ant-abc' }, { token: 'x' }, { ANTHROPIC_API_KEY: 'sk-ant-abc' }]) expect((await put('model', { source: 'key', ...extra })).status).toBe(400);
    expect(JSON.stringify((await sql('select data from setup_steps order by step')).rows)).toBe(before);
    expect(JSON.stringify((await sql('select * from audit_log')).rows)).not.toContain('sk-ant-abc');
  });
});
