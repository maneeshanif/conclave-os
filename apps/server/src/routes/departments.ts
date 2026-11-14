import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import type { Pool } from 'pg';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { PlotsFull, StampError, addDepartmentRoom, readOfficeMap, type OfficeMapJson } from '@conclave/shared';
import type { AppEnv } from '../app';
import type { Bus } from '../bus';
import { CompanyLoadError, loadCompany } from '../company/loader';
import { DepartmentsFileSchema } from '../company/schema';
import { syncCompany } from '../company/sync';

const Body = z.object({ name: z.string().max(60) });
const slug = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');

/** One addition at a time for each company folder: two at once would both pick the same plot. */
const locks = new Map<string, Promise<unknown>>();
const exclusive = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const next = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
  locks.set(key, next.catch(() => undefined));
  return next;
};

const replaceFile = async (file: string, text: string) => {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
};

/**
 * Adding a department from the office (S6-13b): a room for it is stamped onto the map, it is listed in `departments.yaml`, and the
 * company folder is copied into the database again. Both files are checked before either is written, and put back if a later step fails.
 */
export function departmentRoutes(deps: { workspaceId: string; companyRoot: string; pool?: Pool; bus?: Bus }) {
  const r = new Hono<AppEnv>();

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
