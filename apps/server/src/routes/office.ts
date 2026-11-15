import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import type { Bus } from '../bus';
import type { Dispatcher } from '../workflows/dispatch';
import { assignDesks, loadOffice } from '../office/desks';
import { officeState, teamCards } from '../office/state';

/** The office (SPEC 12): the map's facts and where each agent sits. The drawing reads the map file itself from /office/map. */
export function officeRoutes(deps: { workspaceId: string; companyRoot: string; /** For the agent templates (S6-13c). */ templatesRoot?: string; bus?: Bus; dispatcher?: Dispatcher; /** The agents in an open discussion; the Boardroom supplies it (S6-10). */ discussing?: (c: import('pg').PoolClient) => Promise<Set<string>> }) {
  const r = new Hono<AppEnv>();

  r.get('/', async (c) => {
    let office;
    try {
      office = await loadOffice(deps.companyRoot);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 422);
    }
    const tx = c.get('tx').client;
    const seats = await assignDesks(tx, deps.workspaceId, office.map);
    const agents = await tx.query<{ id: string; key: string; name: string; department: string | null; status: string }>(
      "select a.id, a.key, a.name, d.key as department, a.status from agents a left join departments d on d.id = a.department_id where a.status <> 'retired' order by a.created_at, a.key",
    );
    const { walls, ...facts } = office.map;
    return c.json({
      map: { ...facts, walls: walls.map((row) => row.map((w) => (w ? '#' : '.')).join('')) },
      agents: agents.rows.map((a) => {
        const seat = seats.find((s) => s.agentId === a.id);
        return { id: a.id, key: a.key, name: a.name, department: a.department, status: a.status, room: seat?.room ?? null, desk: seat?.slot ?? null };
      }),
    });
  });

  r.get('/state', async (c) => {
    let office;
    try {
      office = await loadOffice(deps.companyRoot);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 422);
    }
    return c.json({ places: await officeState(c.get('tx').client, deps.workspaceId, office.map, deps.discussing ? await deps.discussing(c.get('tx').client) : undefined) });
  });

  r.get('/agents/:id', async (c) => {
    const tx = c.get('tx').client;
    const id = c.req.param('id');
    if (!z.uuid().safeParse(id).success) return c.json({ error: 'Not found' }, 404);
    const a = await tx.query<{ id: string; key: string; name: string; department: string | null; status: string }>(
      'select a.id, a.key, a.name, d.key as department, a.status from agents a left join departments d on d.id = a.department_id where a.id = $1',
      [id],
    );
    if (!a.rows[0]) return c.json({ error: 'Not found' }, 404);
    const run = await tx.query(
      "select id, status, trigger, started_at, task_id from runs where agent_id = $1 and status in ('running','queued','waiting_approval') order by started_at desc nulls last limit 1",
      [id],
    );
    const tasks = await tx.query(
      "select id, title, status, priority, created_at from tasks where assignee_id = $1 and status not in ('done','cancelled') order by created_at desc limit 50",
      [id],
    );
    return c.json({ agent: a.rows[0], run: run.rows[0] ?? null, tasks: tasks.rows });
  });

  const Message = z.object({ text: z.string().trim().min(1).max(20_000) });
  r.post('/agents/:id/message', async (c) => {
    const tx = c.get('tx').client;
    const id = c.req.param('id');
    if (!z.uuid().safeParse(id).success) return c.json({ error: 'Not found' }, 404);
    const parsed = Message.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Write a message first.' }, 400);
    const a = await tx.query("select id from agents where id = $1 and status <> 'retired'", [id]);
    if (!a.rows[0]) return c.json({ error: 'Not found' }, 404);
    const text = parsed.data.text;
    const title = text.split(String.fromCharCode(10))[0]!.replace(String.fromCharCode(13), "").slice(0, 300);
    const row = await tx.query<{ id: string }>(
      "insert into tasks (workspace_id, title, body, assignee_id, created_by) values ($1, $2, $3, $4, 'founder') returning id",
      [deps.workspaceId, title, text, id],
    );
    const taskId = row.rows[0]!.id;
    c.get('after').push(async () => {
      deps.bus?.publish({ kind: 'task.changed', workspaceId: deps.workspaceId, taskId });
      await deps.dispatcher?.request({ workspaceId: deps.workspaceId, agentId: id, trigger: 'task_assigned' });
    });
    return c.json({ id: taskId }, 201);
  });

  const templateNames = async () => {
    if (!deps.templatesRoot) return [];
    const dir = path.join(deps.templatesRoot, 'agents');
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    return entries.filter((e) => e.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(e.name) && existsSync(path.join(dir, e.name, 'template.yaml'))).map((e) => e.name).sort();
  };

  r.get('/agent-templates', async (c) => c.json({ templates: await templateNames() }));

  // Proposing an agent (S6-13c). Nothing is created here: it is a proposal that a person approves, and then the executor adds the agent.
  const Proposal = z.object({ department: z.string().min(1).max(60), template: z.string().regex(/^[a-z0-9][a-z0-9-]*$/), name: z.string().trim().min(1).max(60).optional() });
  r.post('/agent-proposals', async (c) => {
    const parsed = Proposal.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Choose a department and a template, and give a name of at most 60 characters if you want one.' }, 400);
    const { department, template, name } = parsed.data;
    const tx = c.get('tx').client;
    if (!(await tx.query('select 1 from departments where key = $1', [department])).rows[0]) return c.json({ error: `There is no department "${department}".` }, 400);
    if (!(await templateNames()).includes(template)) return c.json({ error: `There is no agent template "${template}".` }, 400);
    // The agent's id is chosen now, and not one that an agent or any earlier proposal already uses.
    const used = new Set<string>([
      ...(await tx.query<{ key: string }>('select key from agents')).rows.map((a) => a.key),
      ...(await tx.query<{ dedupe_key: string }>("select dedupe_key from approvals where kind = 'agent.create'")).rows.map((a) => a.dedupe_key.replace(/^agent:/, '')),
    ]);
    let id = `${department}-${template}`;
    for (let n = 2; used.has(id); n++) id = `${department}-${template}-${n}`;
    const row = await tx.query<{ id: string }>(
      "insert into approvals (workspace_id, kind, dedupe_key, payload) values ($1, 'agent.create', $2, $3) returning id",
      [deps.workspaceId, `agent:${id}`, JSON.stringify({ department, template, id, ...(name ? { name } : {}) })],
    );
    const approvalId = row.rows[0]!.id;
    c.get('after').push(async () => deps.bus?.publish({ kind: 'approval.changed', workspaceId: deps.workspaceId, approvalId, status: 'pending' }));
    return c.json({ approvalId, id }, 201);
  });

  r.get('/team', async (c) => {
    let office;
    try {
      office = await loadOffice(deps.companyRoot);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 422);
    }
    const tx = c.get('tx').client;
    return c.json({ team: await teamCards(tx, deps.workspaceId, office.map, deps.discussing ? await deps.discussing(tx) : undefined) });
  });

  r.get('/map', async (c) => {
    try {
      await loadOffice(deps.companyRoot); // refuse to serve a map the OS cannot read
    } catch (err) {
      return c.json({ error: (err as Error).message }, 422);
    }
    return c.body(await readFile(path.join(deps.companyRoot, 'office.tmj'), 'utf8'), 200, { 'content-type': 'application/json' });
  });

  return r;
}
