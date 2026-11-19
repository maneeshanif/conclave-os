import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { suggestFor, weeklyScorecards } from '../src/talent/scorecards';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

/** Weekly scorecards (S8-7): counted from the tables. */
let sys: System;
let app: ReturnType<typeof createApp>;
let agentId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const WEEK = new Date(Date.now() - 7 * 86_400_000);

async function run(status: string, cost: number, repaired = false, boundary = 0) {
  const id = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status, started_at, cost_usd) values ($1, $2, 'task', 'claude-cli', $3, now() - interval '1 day', $4) returning id", [ws(), agentId, status, cost])).rows[0].id as string;
  if (repaired) await sql("insert into run_events (workspace_id, run_id, type, data) values ($1, $2, 'repair', '{}')", [ws(), id]);
  for (let i = 0; i < boundary; i++) await sql("insert into run_events (workspace_id, run_id, type, data) values ($1, $2, 'tool_result', $3)", [ws(), id, JSON.stringify({ type: 'tool_result', tool: 'send_email', ok: false, summary: 'Unknown tool "send_email".' })]);
}
async function approval(status: string, edited: boolean, dedupe: string) {
  await sql("insert into approvals (workspace_id, kind, dedupe_key, agent_id, payload, status, edited_payload, decided_at, decided_by) values ($1, 'email.send', $2, $3, '{}', $4, $5, now() - interval '1 day', 'founder')", [ws(), dedupe, agentId, status, edited ? '{"body":"x"}' : null]);
}

beforeAll(async () => {
  ({ sys } = await testSystem());
  await agentNew(sys, { template: 'writer', department: 'outreach', id: 'score-w', name: 'Wren' });
  agentId = (await sql("select id from agents where key = 'score-w'")).rows[0].id;
  await sql("update agents set status = 'active' where id = $1", [agentId]);
  await sql("insert into tasks (workspace_id, title, status, assignee_id, created_by, done_at) values ($1, 'Done', 'done', $2, 'founder', now() - interval '2 days')", [ws(), agentId]);
  await sql("insert into tasks (workspace_id, title, status, assignee_id, created_by, done_at) values ($1, 'Old', 'done', $2, 'founder', now() - interval '20 days')", [ws(), agentId]);
  await run('succeeded', 0.5);
  await run('succeeded', 0.25, true); // needed a repair: not a check passed
  await run('failed', 0.25, false, 2);
  await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status, started_at, cost_usd) values ($1, $2, 'task', 'claude-cli', 'succeeded', now() - interval '30 days', 9)", [ws(), agentId]);
  await approval('executed', false, 'a');
  await approval('approved', true, 'b');
  await approval('rejected', false, 'c');
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
}, 240_000);
afterAll(() => sys?.close());

describe('weekly scorecards (S8-7)', () => {
  it('count the week from the tables: tasks, runs, checks, decisions, cost and refused tool calls, and nothing older', async () => {
    const card = (await weeklyScorecards(sys.app, ws(), { since: WEEK })).find((c) => c.agentKey === 'score-w')!;
    expect(card).toMatchObject({ tasksDone: 1, runs: 3, checksPassed: 1, accepted: 2, acceptedAsIs: 1, edited: 1, rejected: 1, boundaryAttempts: 2, costUsd: 1 });
    expect(card.costPerAccepted).toBe(0.5);
    expect(card.suggestion?.move).toBe('different_persona'); // one of three runs passed its checks
  });

  it('leaves out an agent that is not active', async () => {
    await sql("update agents set status = 'paused' where id = $1", [agentId]);
    expect((await weeklyScorecards(sys.app, ws(), { since: WEEK })).some((c) => c.agentKey === 'score-w')).toBe(false);
    await sql("update agents set status = 'active' where id = $1", [agentId]);
  });

  it('suggests one of three moves for a weak agent, boundaries first', () => {
    const ok = { runs: 5, checksPassed: 5, accepted: 5, edited: 0, rejected: 0, boundaryAttempts: 0 };
    expect(suggestFor(ok)).toBeNull();
    expect(suggestFor({ ...ok, boundaryAttempts: 3, checksPassed: 0 })?.move).toBe('bench');
    expect(suggestFor({ ...ok, checksPassed: 1 })?.move).toBe('different_persona');
    expect(suggestFor({ ...ok, accepted: 3, edited: 3, rejected: 1 })?.move).toBe('skill_patch');
    expect(suggestFor({ runs: 1, checksPassed: 0, accepted: 0, edited: 0, rejected: 1, boundaryAttempts: 0 })).toBeNull(); // too little to judge
  });

  it('are served at /api/scorecards for the last seven days by default', async () => {
    const list = ((await (await app.request('/api/scorecards')).json()) as { scorecards: { agentKey: string; tasksDone: number }[] }).scorecards;
    expect(list.find((c) => c.agentKey === 'score-w')).toMatchObject({ tasksDone: 1 });
    expect((await app.request('/api/scorecards?days=0')).status).toBe(400);
  });
});
