import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { agentNew } from '../src/commands/agent-new';
import { parseRoleFile } from '../src/company/loader';
import { withWorkspace } from '../src/db/tenant';
import { loadTemplate, renderRoleFile } from '../src/harness/render';
import { REPO_ROOT } from '../src/paths';
import type { System } from '../src/system';
import { heartbeatDue, tick, type Dispatcher, type RunRequestEvent } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

let sys: System;
let agentId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const at = (iso: string) => new Date(iso);

/** Records what the ticker asks for instead of running anything. */
function recorder() {
  const requests: RunRequestEvent[] = [];
  const dispatcher: Dispatcher = { name: 'local', request: async (e) => void requests.push(e) };
  return { requests, dispatcher };
}
const UTC = { tz: 'UTC' };
const morningTasks = async () => (await sql("select title, body, assignee_id, status, created_by from tasks where kind = 'heartbeat' order by created_at")).rows;

beforeAll(async () => {
  ({ sys } = await testSystem());
  await agentNew(sys, { template: 'prospector', department: 'lead-gen', id: 'hb-prospector' });
  agentId = (await sql("select id from agents where key = 'hb-prospector'")).rows[0].id;
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql("update agents set status = 'active', heartbeat_cron = '0 7 * * *', heartbeat_task = 'Find 10 new clinics that fit and add them with their sources.', last_heartbeat_at = null where id = $1", [agentId]);
  await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0', [ws()]);
  await sql("delete from runs where agent_id = $1", [agentId]);
  await sql("delete from tasks where kind = 'heartbeat'");
});

describe('the cron decision (S2-8)', () => {
  it('uses the company\'s time zone, not the server\'s', () => {
    // 07:00 in Karachi (UTC+5) is 02:00 UTC.
    expect(heartbeatDue('0 7 * * *', null, at('2026-11-13T02:00:30Z'), { tz: 'Asia/Karachi' })).toBe(true);
    expect(heartbeatDue('0 7 * * *', null, at('2026-11-13T07:00:30Z'), { tz: 'Asia/Karachi' })).toBe(false);
    expect(heartbeatDue('0 7 * * *', null, at('2026-11-13T07:00:30Z'), UTC)).toBe(true);
  });
});

describe('the morning heartbeat (S2-8)', () => {
  it('asks the prospector once each morning, with a task to do, and not at any other minute', async () => {
    const { requests, dispatcher } = recorder();
    await tick(sys.app, ws(), dispatcher, at('2026-11-13T06:59:00Z'), new Map(), UTC);
    expect(requests).toHaveLength(0);
    await tick(sys.app, ws(), dispatcher, at('2026-11-13T07:00:30Z'), new Map(), UTC);
    expect(requests).toEqual([{ workspaceId: ws(), agentId, trigger: 'heartbeat' }]);
    const tasks = await morningTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ assignee_id: agentId, status: 'todo', created_by: 'system', body: 'Find 10 new clinics that fit and add them with their sources.' });
    expect(tasks[0].title).toBe('Scheduled run 2026-11-13');
    // every later minute that morning: nothing more
    for (const t of ['07:01:00', '07:30:00', '12:00:00']) await tick(sys.app, ws(), dispatcher, at(`2026-11-13T${t}Z`), new Map(), UTC);
    expect(requests).toHaveLength(1);
    expect(await morningTasks()).toHaveLength(1);
    // and again the next morning (once the first task is done, so a new one is made)
    await sql("update tasks set status = 'done' where kind = 'heartbeat'");
    await tick(sys.app, ws(), dispatcher, at('2026-11-14T07:00:10Z'), new Map(), UTC);
    expect(requests).toHaveLength(2);
    expect((await morningTasks()).map((t) => t.title)).toEqual(['Scheduled run 2026-11-13', 'Scheduled run 2026-11-14']);
  });

  it('remembers it asked across a restart: a fresh ticker does not ask again', async () => {
    const { requests, dispatcher } = recorder();
    await tick(sys.app, ws(), dispatcher, at('2026-11-13T07:00:30Z'), new Map(), UTC);
    await tick(sys.app, ws(), dispatcher, at('2026-11-13T07:05:00Z'), new Map(), UTC); // a new, empty memory: the process was restarted
    await tick(sys.app, ws(), dispatcher, at('2026-11-13T09:00:00Z'), new Map(), UTC);
    expect(requests).toHaveLength(1);
    expect(await morningTasks()).toHaveLength(1);
  });

  it('two tickers at the same moment make one request', async () => {
    const { requests, dispatcher } = recorder();
    await Promise.all([1, 2, 3].map(() => tick(sys.app, ws(), dispatcher, at('2026-11-13T07:00:30Z'), new Map(), UTC)));
    expect(requests).toHaveLength(1);
    expect(await morningTasks()).toHaveLength(1);
  });

  it('does not ask at all while the kill switch is on, and does not ask later for the morning it missed', async () => {
    const { requests, dispatcher } = recorder();
    await sql('update workspace_settings set kill_switch = 1');
    await tick(sys.app, ws(), dispatcher, at('2026-11-13T07:00:30Z'), new Map(), UTC);
    expect(requests).toHaveLength(0);
    expect(await morningTasks()).toHaveLength(0);
    await sql('update workspace_settings set kill_switch = 0');
    await tick(sys.app, ws(), dispatcher, at('2026-11-13T07:30:00Z'), new Map(), UTC); // the switch is off, but that morning is gone
    expect(requests).toHaveLength(0);
    await tick(sys.app, ws(), dispatcher, at('2026-11-14T07:00:30Z'), new Map(), UTC); // the next one runs
    expect(requests).toHaveLength(1);
  });

  it('catches up once after being down, and only if the morning was recent; it never replays a burst of days', async () => {
    const { requests, dispatcher } = recorder();
    await sql("update agents set last_heartbeat_at = $2 where id = $1", [agentId, '2026-11-10T07:00:05Z']); // last ran three days ago
    // The laptop wakes up at 11:00 on the 13th: 07:00 that day was 4 hours ago. One run, not three.
    await tick(sys.app, ws(), dispatcher, at('2026-11-13T11:00:00Z'), new Map(), UTC);
    expect(requests).toHaveLength(1);
    expect(await morningTasks()).toHaveLength(1);
    await tick(sys.app, ws(), dispatcher, at('2026-11-13T11:01:00Z'), new Map(), UTC);
    expect(requests).toHaveLength(1);
  });

  it('lets a morning go by if the laptop wakes up much too late for it', async () => {
    const { requests, dispatcher } = recorder();
    await sql("update agents set last_heartbeat_at = $2 where id = $1", [agentId, '2026-11-10T07:00:05Z']);
    await tick(sys.app, ws(), dispatcher, at('2026-11-13T15:00:00Z'), new Map(), UTC); // 8 hours after 07:00
    expect(requests).toHaveLength(0);
    await tick(sys.app, ws(), dispatcher, at('2026-11-14T07:00:20Z'), new Map(), UTC);
    expect(requests).toHaveLength(1);
  });

  it('does not make a second morning task while the first is still open', async () => {
    const { requests, dispatcher } = recorder();
    await tick(sys.app, ws(), dispatcher, at('2026-11-13T07:00:30Z'), new Map(), UTC);
    await tick(sys.app, ws(), dispatcher, at('2026-11-14T07:00:30Z'), new Map(), UTC); // yesterday's was never picked up
    expect(await morningTasks()).toHaveLength(1);
    expect(requests).toHaveLength(2); // the agent is still woken, to finish what is open
  });

  it('wakes an agent with no standing task without making one, and skips a paused agent', async () => {
    const { requests, dispatcher } = recorder();
    await sql('update agents set heartbeat_task = null where id = $1', [agentId]);
    await tick(sys.app, ws(), dispatcher, at('2026-11-13T07:00:30Z'), new Map(), UTC);
    expect(requests).toHaveLength(1);
    expect(await morningTasks()).toHaveLength(0);
    await sql("update agents set status = 'paused', last_heartbeat_at = null where id = $1", [agentId]);
    await tick(sys.app, ws(), dispatcher, at('2026-11-14T07:00:30Z'), new Map(), UTC);
    expect(requests).toHaveLength(1);
  });

  it('ignores a heartbeat that is not a valid schedule', async () => {
    const { requests, dispatcher } = recorder();
    await sql("update agents set heartbeat_cron = 'every morning' where id = $1", [agentId]);
    await tick(sys.app, ws(), dispatcher, at('2026-11-13T07:00:30Z'), new Map(), UTC);
    expect(requests).toHaveLength(0);
  });
});

describe('the prospector ships with a morning run (S2-8)', () => {
  it('has a heartbeat and a standing task in its template, and they reach the role file and the database', async () => {
    const t = await loadTemplate(`${REPO_ROOT}/templates`, 'prospector');
    expect(t.file.defaults.heartbeat).toBe('0 7 * * *');
    expect(t.file.defaults.heartbeat_task).toMatch(/add_lead|add them/i);
    const text = renderRoleFile(t, { id: 'p', name: 'P', department: 'lead-gen', department_name: 'Lead Gen', company_name: 'Acme' });
    expect(parseRoleFile(text, 'x/AGENT.md').role).toMatchObject({ heartbeat: '0 7 * * *', heartbeat_task: expect.stringContaining('fit') });
    await agentNew(sys, { template: 'prospector', department: 'lead-gen', id: 'hb-prospector-2' });
    const row = (await sql("select heartbeat_cron, heartbeat_task from agents where key = 'hb-prospector-2'")).rows[0];
    expect(row).toEqual({ heartbeat_cron: '0 7 * * *', heartbeat_task: expect.stringContaining('fit') });
  });

  it('leaves the scorer and the outreach rep without a schedule of their own', async () => {
    for (const key of ['scorer', 'outreach-rep']) expect((await loadTemplate(`${REPO_ROOT}/templates`, key)).file.defaults.heartbeat).toBeUndefined();
  });
});
