import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { CompanyError, type Companies } from '../companies';

const New = z.object({ name: z.string(), template: z.string() });

/** The companies you can switch between, and making a new one from a template (S6-13a). Folder paths stay on the server. */
export function companyRoutes(deps: { companies: Companies }) {
  const r = new Hono<AppEnv>();

  r.get('/', async (c) => {
    const list = await deps.companies.list();
    return c.json({ companies: list.map(({ id, slug, name, isDefault }) => ({ id, slug, name, isDefault })), templates: await deps.companies.templates() });
  });

  r.post('/', async (c) => {
    const parsed = New.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Send a name and a template.' }, 400);
    try {
      const { id, slug, name, isDefault } = await deps.companies.create(parsed.data);
      return c.json({ id, slug, name, isDefault }, 201);
    } catch (err) {
      if (err instanceof CompanyError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  return r;
}
