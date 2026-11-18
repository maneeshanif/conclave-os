import { existsSync } from 'node:fs';
import { loadCompany } from '../company/loader';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import { terminalLines } from '../office/terminal';
import type { AppEnv } from '../app';
import type { Bus } from '../bus';
import type { Dispatcher } from '../workflows/dispatch';
import { assignDesks, loadOffice } from '../office/desks';
import { activityFeed } from '../office/activity';
import { exclusive, undoMap, writeMap } from '../office/map-file';
import { EditError, growRoom, moveDecor, placeDecor, readOfficeMap, removeDecor, setDoor, type OfficeMapJson } from '@conclave/shared';
import { officeState, teamCards } from '../office/state';

class NotThere extends Error {}

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
    // The live terminal (S6C-6): the last steps of the agent's latest run, running or not.
    const latest = (await tx.query<{ id: string; status: string }>('select id, status from runs where agent_id = $1 order by started_at desc nulls last, id desc limit 1', [id])).rows[0];
    const events = latest ? (await tx.query<{ type: string; data: Record<string, unknown> }>('select type, data from (select id, type, data from run_events where run_id = $1 order by id desc limit 200) e order by id', [latest.id])).rows : [];
    return c.json({ agent: a.rows[0], run: run.rows[0] ?? null, tasks: tasks.rows, terminal: latest ? { runId: latest.id, status: latest.status, lines: terminalLines(events) } : null });
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

  r.get('/activity', async (c) => c.json({ events: await activityFeed(c.get('tx').client) }));

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

  // Editing the office from inside it (S6B-9): put scenery down or take it away. The rules are in the shared package; the map is checked
  // before it is written, one change at a time.
  const Place = z.object({ name: z.string().max(40), x: z.number(), y: z.number(), turn: z.number().optional() });
  const mapFile = () => path.join(deps.companyRoot, 'office.tmj');
  const departmentsNow = async () => (await loadCompany(deps.companyRoot)).departments.map((d) => ({ key: d.key, active: d.active }));
  r.post('/decor', async (c) => {
    const body = Place.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Say which picture and which tile.' }, 400);
    try {
      const id = await exclusive(deps.companyRoot, async () => {
        const json = JSON.parse(await readFile(mapFile(), 'utf8')) as OfficeMapJson;
        const next = placeDecor(json, body.data, await departmentsNow());
        await writeMap(mapFile(), JSON.stringify(next, null, 1) + '\n');
        return Number(next.nextobjectid) - 1;
      });
      deps.bus?.publish({ kind: 'office.changed', workspaceId: deps.workspaceId });
      return c.json({ id }, 201);
    } catch (err) {
      if (err instanceof EditError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  r.delete('/decor/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Not found' }, 404);
    try {
      await exclusive(deps.companyRoot, async () => {
        const json = JSON.parse(await readFile(mapFile(), 'utf8')) as OfficeMapJson;
        await writeMap(mapFile(), JSON.stringify(removeDecor(json, id), null, 1) + '\n');
      });
      deps.bus?.publish({ kind: 'office.changed', workspaceId: deps.workspaceId });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof EditError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  // Move a piece to another tile in one change (S6C-2): nothing is written if the new place is refused.
  const Move = z.object({ x: z.number(), y: z.number() });
  r.post('/decor/:id/move', async (c) => {
    const id = Number(c.req.param('id'));
    const body = Move.safeParse(await c.req.json().catch(() => null));
    if (!Number.isInteger(id) || !body.success) return c.json({ error: 'Say which tile.' }, 400);
    try {
      await exclusive(deps.companyRoot, async () => {
        const json = JSON.parse(await readFile(mapFile(), 'utf8')) as OfficeMapJson;
        if (!(json.layers.find((l) => l.name === 'decor')?.objects ?? []).some((o) => o.id === id)) throw new NotThere();
        await writeMap(mapFile(), JSON.stringify(moveDecor(json, id, body.data, await departmentsNow()), null, 1) + '\n');
      });
      deps.bus?.publish({ kind: 'office.changed', workspaceId: deps.workspaceId });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof NotThere) return c.json({ error: 'Not found' }, 404);
      if (err instanceof EditError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  // Undo the last edit to the map (S6C-2), as far back as the history goes. The result must still read.
  // A door: click a wall tile to open it, click a gap to close it (S6C-2). One change, refused and unchanged if the new place is not allowed.
  const Door = z.object({ x: z.number(), y: z.number() }).strict();
  r.post('/door', async (c) => {
    const body = Door.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Say which tile.' }, 400);
    try {
      const opened = await exclusive(deps.companyRoot, async () => {
        const json = JSON.parse(await readFile(mapFile(), 'utf8')) as OfficeMapJson;
        const floor = json.layers.find((l) => l.name === 'floor')?.data ?? [];
        const open = floor[body.data.y * json.width + body.data.x] === 2;
        await writeMap(mapFile(), JSON.stringify(setDoor(json, { ...body.data, open }, await departmentsNow()), null, 1) + '\n');
        return open;
      });
      deps.bus?.publish({ kind: 'office.changed', workspaceId: deps.workspaceId });
      return c.json({ ok: true, opened });
    } catch (err) {
      if (err instanceof EditError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  // Make the room under a tile one tile bigger on one side (S6C-2). One change, refused and unchanged if something is in the way.
  const Grow = z.object({ x: z.number().int(), y: z.number().int(), side: z.enum(['north', 'south', 'east', 'west']) }).strict();
  r.post('/room/grow', async (c) => {
    const body = Grow.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Say which tile in the room, and which side.' }, 400);
    try {
      await exclusive(deps.companyRoot, async () => {
        const json = JSON.parse(await readFile(mapFile(), 'utf8')) as OfficeMapJson;
        const departments = await departmentsNow();
        const rooms = readOfficeMap(json, { file: 'office.tmj', departments }).rooms;
        const { x, y } = body.data;
        // The smallest room that holds the tile, so a park around other rooms does not win over the room you clicked in.
        const here = rooms.filter((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h).sort((a, b) => a.w * a.h - b.w * b.h)[0];
        if (!here) throw new EditError('Click inside a room.');
        await writeMap(mapFile(), JSON.stringify(growRoom(json, { room: here.name, side: body.data.side }, departments), null, 1) + '\n');
      });
      deps.bus?.publish({ kind: 'office.changed', workspaceId: deps.workspaceId });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof EditError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  r.post('/undo', async (c) => {
    const done = await exclusive(deps.companyRoot, async () => {
      const ok = await undoMap(mapFile());
      if (ok) readOfficeMap(JSON.parse(await readFile(mapFile(), 'utf8')) as OfficeMapJson, { file: 'office.tmj', departments: await departmentsNow() });
      return ok;
    });
    if (!done) return c.json({ error: 'There is nothing to undo.' }, 404);
    deps.bus?.publish({ kind: 'office.changed', workspaceId: deps.workspaceId });
    return c.json({ ok: true });
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
