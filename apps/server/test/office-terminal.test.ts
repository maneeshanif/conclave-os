import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { terminalLines } from '../src/office/terminal';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

/** The live terminal in an agent's drawer (S6C-6). */
let sys: System;
let app: ReturnType<typeof createApp>;
let agentId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const ev = (runId: string, type: string, data: unknown) => sql('insert into run_events (workspace_id, run_id, type, data) values ($1, $2, $3, $4)', [ws(), runId, type, JSON.stringify(data)]);
const drawer = async () => (await (await app.request(`/api/office/agents/${agentId}`)).json()) as { terminal: { runId: string; status: string; lines: { kind: string; text: string }[] } | null };

beforeAll(async () => {
  ({ sys } = await testSystem());
  await agentNew(sys, { template: 'writer', department: 'outreach', id: 'term-w', name: 'Tess' });
  agentId = (await sql("select id from agents where key = 'term-w'")).rows[0].id;
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), companyRoot: sys.companyRoot, templatesRoot: sys.templatesRoot });
}, 240_000);
afterAll(() => sys?.close());

describe('terminalLines (S6C-6)', () => {
  it('turns steps into lines, leaves out what nobody watches, cuts long lines, and keeps the last forty', () => {
    const lines = terminalLines([
      { type: 'session', data: { sessionId: 's' } },
      { type: 'tool_call', data: { tool: 'get_task', input: {} } },
      { type: 'tool_result', data: { tool: 'get_task', ok: true, summary: 'Write a page.' } },
      { type: 'tool_result', data: { tool: 'send_email', ok: false, summary: 'Unknown tool "send_email".' } },
      { type: 'cost', data: { usd: 1 } },
      { type: 'message', data: { text: 'x'.repeat(1000) } },
      { type: 'error', data: { kind: 'limit', message: 'Plan limit.' } },
    ]);
    expect(lines.map((l) => l.kind)).toEqual(['call', 'result', 'result', 'say', 'error']);
    expect(lines[0]!.text).toBe('$ get_task {}');
    expect(lines[2]!.text).toBe('✗ Unknown tool "send_email".');
    expect(lines[3]!.text.length).toBeLessThanOrEqual(300);
    expect(lines[4]!.text).toBe('error (limit): Plan limit.');
    const many = terminalLines(Array.from({ length: 100 }, (_, i) => ({ type: 'message', data: { text: `step ${i}` } })));
    expect(many).toHaveLength(40);
    expect(many.at(-1)!.text).toBe('step 99');
  });
});

describe('the drawer terminal (S6C-6)', () => {
  it('is empty for an agent that has never run', async () => {
    expect((await drawer()).terminal).toBeNull();
  });

  it('shows the latest run in order, with its status, and follows a newer run', async () => {
    const r1 = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status, started_at) values ($1, $2, 'task', 'claude-cli', 'succeeded', now() - interval '1 hour') returning id", [ws(), agentId])).rows[0].id as string;
    await ev(r1, 'tool_call', { tool: 'old_run', input: {} });
    const r2 = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status, started_at) values ($1, $2, 'task', 'claude-cli', 'running', now()) returning id", [ws(), agentId])).rows[0].id as string;
    await ev(r2, 'tool_call', { tool: 'get_task', input: {} });
    await ev(r2, 'tool_result', { tool: 'get_task', ok: true, summary: 'Write a page.' });
    const t = (await drawer()).terminal!;
    expect(t).toMatchObject({ runId: r2, status: 'running' });
    expect(t.lines).toEqual([{ kind: 'call', text: '$ get_task {}' }, { kind: 'result', text: '✓ Write a page.' }]);
    await ev(r2, 'message', { text: 'Working on it.' });
    expect((await drawer()).terminal!.lines.at(-1)).toEqual({ kind: 'say', text: 'Working on it.' });
  });
});
