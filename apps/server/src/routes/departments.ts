import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import type { Pool } from 'pg';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { PlotsFull, RoomFull, StampError, addDepartmentRoom, addDeskToRoom, readOfficeMap, type OfficeMapJson } from '@conclave/shared';
import type { AppEnv } from '../app';
import type { Bus } from '../bus';
import { exclusive, replaceFile } from '../office/map-file';
import { CompanyLoadError, loadCompany } from '../company/loader';
import { DepartmentsFileSchema } from '../company/schema';
import { syncCompany } from '../company/sync';

const Body = z.object({ name: z.string().max(60) });
const slug = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');

/**
 * Adding a department from the office (S6-13b): a room for it is stamped onto the map, it is listed in `departments.yaml`, and the
 * company folder is copied into the database again. Both files are checked before either is written, and put back if a later step fails.
 */
export function departmentRoutes(deps: { workspaceId: string; companyRoot: string; pool?: Pool; bus?: Bus }) {
  const r = new Hono<AppEnv>();

  const KEY = /^[a-z0-9][a-z0-9-]{0,60}$/;
  const departmentId = async (c: import('hono').Context<AppEnv>, key: string): Promise<{ id: string; name: string } | null> => {
    if (!KEY.test(key)) return null;
    return (await c.get('tx').client.query<{ id: string; name: string }>('select id, name from departments where key = $1', [key])).rows[0] ?? null;
  };

  // A department's shared board: its open tasks (those given to its agents, and those given to the department), moving ones first.
  r.get('/:key/board', async (c) => {
    const key = c.req.param('key');
    const dept = await departmentId(c, key);
    if (!dept) return c.json({ error: 'Not found' }, 404);
    const tx = c.get('tx').client;
    const tasks = await tx.query(
      `select t.id, t.title, t.status, t.priority, t.blocked_reason, t.created_at, a.key as assignee_key, a.name as assignee_name
       from tasks t left join agents a on a.id = t.assignee_id
       where t.status not in ('done', 'cancelled') and (t.department_id = $1 or a.department_id = $1)
       order by case t.status when 'in_progress' then 0 when 'waiting_approval' then 1 when 'blocked' then 2 else 3 end, t.created_at desc limit 200`,
      [dept.id],
    );
    const agents = await tx.query("select key, name, status from agents where department_id = $1 and status <> 'retired' order by created_at, key", [dept.id]);
    return c.json({ department: { key, name: dept.name }, tasks: tasks.rows, agents: agents.rows });
  });

  // A department's channel: short messages between its agents and the owner, the latest hundred, oldest first.
  r.get('/:key/channel', async (c) => {
    const dept = await departmentId(c, c.req.param('key'));
    if (!dept) return c.json({ error: 'Not found' }, 404);
    const rows = await c.get('tx').client.query('select id, author, body, created_at from (select id, author, body, created_at from department_messages where department_id = $1 order by created_at desc, id desc limit 100) m order by created_at, id', [dept.id]);
    return c.json({ messages: rows.rows });
  });

  const Say = z.object({ body: z.string().trim().min(1).max(2000) });
  r.post('/:key/channel', async (c) => {
    const key = c.req.param('key');
    const parsed = Say.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Write a message of up to 2000 characters.' }, 400);
    const dept = await departmentId(c, key);
    if (!dept) return c.json({ error: 'Not found' }, 404);
    const row = await c.get('tx').client.query<{ id: string }>("insert into department_messages (workspace_id, department_id, author, body) values ($1, $2, 'founder', $3) returning id", [deps.workspaceId, dept.id, parsed.data.body]);
    c.get('after').push(async () => deps.bus?.publish({ kind: 'department.changed', workspaceId: deps.workspaceId, department: key }));
    return c.json({ id: row.rows[0]!.id }, 201);
  });

  // Add a desk to a department's room (S6B-1): the next free spot of nine. The map is checked before it is written.
  r.post('/:key/desks', async (c) => {
    const key = c.req.param('key');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) return c.json({ error: 'That is not a department key.' }, 400);
    const mapFile = path.join(deps.companyRoot, 'office.tmj');
    try {
      const done = await exclusive(deps.companyRoot, async () => {
        const json = JSON.parse(await readFile(mapFile, 'utf8')) as OfficeMapJson;
        const room = (json.layers.find((l) => l.name === 'rooms')?.objects ?? []).find((r) => r.properties?.some((p) => p.name === 'department' && p.value === key));
        if (!room?.name) throw new StampError(`There is no room for the department "${key}".`);
        const grown = addDeskToRoom(json, room.name);
        const company = await loadCompany(deps.companyRoot);
        readOfficeMap(grown, { file: 'office.tmj', departments: company.departments.map((d) => ({ key: d.key, active: d.active })) });
        await replaceFile(mapFile, JSON.stringify(grown, null, 1) + '\n');
        const desks = (grown.layers.find((l) => l.name === 'desks')?.objects ?? []).filter((d) => d.properties?.some((p) => p.name === 'room' && p.value === room.name)).length;
        return { key, room: room.name, desks };
      });
      deps.bus?.publish({ kind: 'office.changed', workspaceId: deps.workspaceId });
      return c.json(done, 201);
    } catch (err) {
      if (err instanceof RoomFull) return c.json({ error: err.message }, 409);
      if (err instanceof StampError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  r.post('/', async (c) => {
    const parsed = Body.safeParse(await c.req.json().catch(() => null));
    const name = parsed.success ? parsed.data.name.trim() : '';
    const key = slug(name);
    if (!name || !key) return c.json({ error: 'Give the department a name with some letters or numbers in it.' }, 400);

    const mapFile = path.join(deps.companyRoot, 'office.tmj');
    const yamlFile = path.join(deps.companyRoot, 'departments.yaml');
    try {
      const made = await exclusive(deps.companyRoot, async () => {
        const [mapText, yamlText] = await Promise.all([readFile(mapFile, 'utf8'), readFile(yamlFile, 'utf8')]);
        const list = DepartmentsFileSchema.parse(parseYaml(yamlText)).departments;
        if (list.some((d) => d.key === key || d.name.toLowerCase() === name.toLowerCase())) throw new StampError(`There is already a department called "${name}".`);
        const room = Math.max(...list.map((d) => d.room)) + 1;
        const stamped = addDepartmentRoom(JSON.parse(mapText) as OfficeMapJson, { key, name });
        const line = `  - { key: ${key}, name: ${JSON.stringify(name)}, room: ${room}, active: true }`;
        const nextYaml = `${yamlText.replace(/\s*$/, '')}\n${line}\n`;
        // Check the result before anything is written: the map must still read with the new department in it.
        const after = DepartmentsFileSchema.parse(parseYaml(nextYaml)).departments;
        readOfficeMap(stamped, { file: 'office.tmj', departments: after.map((d) => ({ key: d.key, active: d.active })) });
        await replaceFile(mapFile, JSON.stringify(stamped, null, 1) + '\n');
        await replaceFile(yamlFile, nextYaml);
        try {
          if (deps.pool) await syncCompany(deps.pool, deps.workspaceId, await loadCompany(deps.companyRoot));
        } catch (err) {
          await replaceFile(mapFile, mapText);
          await replaceFile(yamlFile, yamlText);
          throw err;
        }
        return { key, name, room };
      });
      deps.bus?.publish({ kind: 'office.changed', workspaceId: deps.workspaceId });
      return c.json(made, 201);
    } catch (err) {
      if (err instanceof PlotsFull) return c.json({ error: err.message }, 409);
      if (err instanceof StampError) return c.json({ error: err.message }, 400);
      if (err instanceof CompanyLoadError) return c.json({ error: `The company folder would not load: ${err.message}` }, 400);
      throw err;
    }
  });

  return r;
}
