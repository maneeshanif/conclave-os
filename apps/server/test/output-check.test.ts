import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { runCheck } from '../src/checks';
import { withWorkspace } from '../src/db/tenant';
import { executeRun, type LoopDeps } from '../src/harness/loop';
import { RunTokens } from '../src/harness/run-tokens';
import type { Runtime, RunEvent, RunRequest } from '../src/runtimes/types';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const draft = (subject: string, body: string) => `Subject: ${subject}\n\n${body}`;
const GOOD = draft('A homepage concept for you', 'Hi Dana, I looked at your booking page and it asks visitors to phone first. Happy to share a concept if useful.');

let sys: System;
let agentId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));

describe('the checks themselves (S3-5)', () => {
  const check = (name: string, output: string) => withWorkspace(sys.app, ws(), ({ client }) => runCheck(client, name, { output, runId: '00000000-0000-4000-8000-000000000000' }));

  it('email-draft passes a short draft with a subject and a body', async () => {
    expect(await check('email-draft', GOOD)).toEqual({ ok: true, reasons: [] });
  });

  it('email-draft fails, with every reason, a draft that breaks its limits', async () => {
    const r = await check('email-draft', draft('A very long subject line that goes on and on', `${words(190)} agentic`));
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/subject.*words/i);
    expect(r.reasons.join(' ')).toMatch(/body.*170/i);
    expect(r.reasons.join(' ')).toMatch(/agentic/i);
  });

  it('email-draft fails output that is not a draft at all', async () => {
    const r = await check('email-draft', 'I have finished the task.');
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/Subject:/);
  });

  it('non-empty fails blank output', async () => {
    expect((await check('non-empty', '   ')).ok).toBe(false);
    expect((await check('non-empty', 'Done.')).ok).toBe(true);
  });

  it('an unknown check is a failure that says so, never a quiet pass', async () => {
    const r = await check('made-up-check', 'anything');
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/unknown output check "made-up-check"/i);
  });
});

class Scripted implements Runtime {
  name = 'claude-cli' as const;
  canResume = true;
  requests: RunRequest[] = [];
  constructor(private outputs: string[]) {}
  async *start(req: RunRequest): AsyncIterable<RunEvent> {
    const out = this.outputs[Math.min(this.requests.length, this.outputs.length - 1)]!;
    this.requests.push(req);
    yield { type: 'session', sessionId: 'ses_1' };
    yield { type: 'done', output: out };
  }
  async cancel() {}
  async health() {
    return { ok: true };
  }
}
const deps = (rt: Runtime): LoopDeps => ({ pool: sys.app, tokens: new RunTokens(), bus: new Bus(), runtimes: { 'claude-cli': rt }, dataDir: sys.dataDir, workspaceSlug: sys.workspace.slug, templatesRoot: sys.templatesRoot, timeoutMs: 30_000 });
const newTask = async () => (await sql("insert into tasks (workspace_id, title, status, assignee_id, created_by) values ($1, 'Write', 'todo', $2, 'founder') returning id", [ws(), agentId])).rows[0].id as string;
const taskRow = async (id: string) => (await sql('select status, blocked_reason from tasks where id = $1', [id])).rows[0];
const events = async (taskId: string, type: string) => (await sql('select e.data from run_events e join runs r on r.id = e.run_id where r.task_id = $1 and e.type = $2 order by e.id', [taskId, type])).rows.map((r) => r.data);
const BAD = draft('x', words(200));

beforeAll(async () => {
  ({ sys } = await testSystem());
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'check-agent' });
  agentId = (await sql("select id from agents where key = 'check-agent'")).rows[0].id;
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0', [ws()]);
  await sql('delete from run_events');
  await sql('delete from approvals');
  await sql('delete from runs');
  await sql('delete from messages where task_id in (select id from tasks where assignee_id = $1)', [agentId]);
  await sql('delete from tasks where assignee_id = $1', [agentId]);
  await sql("update agents set output_check = 'email-draft', fallback_alias = null where id = $1", [agentId]);
});

describe('repair and escalation (S3-5)', () => {
  it('a result that passes ends the task as usual, in one attempt', async () => {
    const rt = new Scripted([GOOD]);
    const t = await newTask();
    expect((await executeRun(deps(rt), ws(), agentId, 'manual')).status).toBe('succeeded');
    expect(rt.requests).toHaveLength(1);
    expect((await taskRow(t)).status).toBe('done');
  });

  it('a failing result is repaired once: the same session is shown what was wrong', async () => {
    const rt = new Scripted([BAD, GOOD]);
    const t = await newTask();
    expect((await executeRun(deps(rt), ws(), agentId, 'manual')).status).toBe('succeeded');
    expect(rt.requests).toHaveLength(2);
    expect(rt.requests[1]!.sessionId).toBe('ses_1');
    expect(rt.requests[1]!.taskInput).toMatch(/failed the email-draft check/i);
    expect(rt.requests[1]!.taskInput).toMatch(/170/);
    expect((await events(t, 'repair'))[0]).toMatchObject({ stage: 'repair', check: 'email-draft' });
    expect((await taskRow(t)).status).toBe('done');
  });

  it('goes to the stronger model if the repair does not fix it, and stops there if that does', async () => {
    await sql("update agents set fallback_alias = 'stronger-model' where id = $1", [agentId]);
    const rt = new Scripted([BAD, BAD, GOOD]);
    const t = await newTask();
    expect((await executeRun(deps(rt), ws(), agentId, 'manual')).status).toBe('succeeded');
    expect(rt.requests.map((r) => r.modelAlias)).toEqual([rt.requests[0]!.modelAlias, rt.requests[0]!.modelAlias, 'stronger-model']);
    expect((await events(t, 'repair')).map((e) => e.stage)).toEqual(['repair', 'escalate']);
    expect((await taskRow(t)).status).toBe('done');
  });

  it('blocks the task for the founder, with the failures, when the stronger model fails too', async () => {
    await sql("update agents set fallback_alias = 'stronger-model' where id = $1", [agentId]);
    const rt = new Scripted([BAD]);
    const t = await newTask();
    const out = await executeRun(deps(rt), ws(), agentId, 'manual');
    expect(out.status).toBe('failed');
    expect(rt.requests).toHaveLength(3);
    const task = await taskRow(t);
    expect(task.status).toBe('blocked');
    expect(task.blocked_reason).toMatch(/email-draft/);
    expect(task.blocked_reason).toMatch(/170/);
    expect(task.blocked_reason).toMatch(/repair/i);
    expect(task.blocked_reason).toMatch(/stronger model/i);
  });

  it('with no stronger model, a failed repair blocks the task', async () => {
    const rt = new Scripted([BAD]);
    const t = await newTask();
    expect((await executeRun(deps(rt), ws(), agentId, 'manual')).status).toBe('failed');
    expect(rt.requests).toHaveLength(2);
    expect((await taskRow(t)).status).toBe('blocked');
  });

  it('leaves a role with no check alone: any output is accepted as before', async () => {
    await sql('update agents set output_check = null where id = $1', [agentId]);
    const rt = new Scripted([BAD]);
    const t = await newTask();
    expect((await executeRun(deps(rt), ws(), agentId, 'manual')).status).toBe('succeeded');
    expect(rt.requests).toHaveLength(1);
    expect((await taskRow(t)).status).toBe('done');
  });

  it('blocks, naming the problem, when the role names a check that does not exist', async () => {
    await sql("update agents set output_check = 'made-up-check' where id = $1", [agentId]);
    const t = await newTask();
    expect((await executeRun(deps(new Scripted([GOOD])), ws(), agentId, 'manual')).status).toBe('failed');
    expect((await taskRow(t)).blocked_reason).toMatch(/unknown output check "made-up-check"/i);
  });

  it('accepts an agent that proposed instead of writing a draft: the proposal handler already checked it', async () => {
    // A run that made an email proposal reports a one-liner, which is not a draft, and that is fine.
    class Proposes extends Scripted {
      override async *start(req: RunRequest): AsyncIterable<RunEvent> {
        await sql("insert into approvals (workspace_id, kind, dedupe_key, run_id, payload, status) values ($1, 'email.send', $2, $3, '{}', 'pending')", [ws(), `chk:${req.runId}`, req.runId]);
        yield* super.start(req);
      }
    }
    const rt = new Proposes(['Proposed one email for Dana.']);
    const t = await newTask();
    expect((await executeRun(deps(rt), ws(), agentId, 'manual')).status).toBe('succeeded');
    expect(rt.requests).toHaveLength(1);
    expect((await taskRow(t)).status).toBe('done');
  });
});
