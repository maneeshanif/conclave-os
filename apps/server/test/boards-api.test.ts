import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

/** The boards: one per goal and one for tasks with no goal, read from the tables. */
let sys: System;
let app: ReturnType<typeof createApp>;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));

beforeAll(async () => {
  ({ sys } = await testSystem());
  await agentNew(sys, { template: 'writer', department: 'outreach', id: 'bd-w', name: 'Bea' });
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
}, 240_000);
afterAll(() => sys?.close());

describe('GET /api/boards', () => {
  it('groups tasks by goal, puts the rest on a board of their own, leaves out cancelled ones, and shows who has each', async () => {
    const goal = (await sql("select id, key from goals order by key limit 1")).rows[0] as { id: string; key: string } | undefined;
    const agent = (await sql("select id from agents where key = 'bd-w'")).rows[0].id as string;
    const mk = (title: string, status: string, goalId: string | null) => sql('insert into tasks (workspace_id, title, status, goal_id, assignee_id, created_by) values ($1, $2, $3, $4, $5, $6)', [ws(), title, status, goalId, agent, 'founder']);
    if (goal) await mk('On a goal', 'todo', goal.id);
    await mk('On nothing', 'in_progress', null);
    await mk('Gone', 'cancelled', null);
    const out = ((await (await app.request('/api/boards')).json()) as { boards: { id: string | null; key: string; tasks: { title: string; status: string; assignee: string | null }[] }[] }).boards;
    const none = out.at(-1)!;
    expect(none).toMatchObject({ id: null, key: 'no-goal' });
    expect(none.tasks.map((x) => x.title)).toEqual(['On nothing']);
    expect(none.tasks[0]).toMatchObject({ status: 'in_progress', assignee: 'bd-w' });
    expect(out.flatMap((b) => b.tasks.map((x) => x.title))).not.toContain('Gone');
    if (goal) expect(out.find((b) => b.id === goal.id)!.tasks.map((x) => x.title)).toEqual(['On a goal']);
    expect(Number((await sql("select count(*)::int as n from tasks where status <> 'cancelled'")).rows[0].n)).toBe(out.reduce((n, b) => n + b.tasks.length, 0));
  });
});
