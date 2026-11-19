import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { PROJECT_KEY, ProjectError, checkProject } from '../projects/projects';

const New = z.object({
  key: z.string().max(60),
  path: z.string().max(1000),
  defaultBranch: z.string().max(100).optional(),
  testCmd: z.string().nullable().optional(),
  buildCmd: z.string().nullable().optional(),
});

const shape = (r: { id: string; key: string; path: string; default_branch: string; test_cmd: string | null; build_cmd: string | null; created_at: string }) => ({
  id: r.id,
  key: r.key,
  path: r.path,
  defaultBranch: r.default_branch,
  testCmd: r.test_cmd,
  buildCmd: r.build_cmd,
  createdAt: r.created_at,
});

/** Projects (S7-1): the git folders coding tasks work on. Registering one checks it; nothing is run, and nothing in the folder is changed. */
export function codeProjectRoutes(deps: { workspaceId: string }) {
  const r = new Hono<AppEnv>();

  r.get('/', async (c) => {
    const rows = await c.get('tx').client.query('select id, key, path, default_branch, test_cmd, build_cmd, created_at from code_projects order by key');
    return c.json({ projects: rows.rows.map(shape) });
  });

  r.post('/', async (c) => {
    const body = New.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Give a key and the full path to the folder.' }, 400);
    let ok;
    try {
      ok = await checkProject(body.data);
    } catch (err) {
      if (err instanceof ProjectError) return c.json({ error: err.message }, 400);
      throw err;
    }
    const tx = c.get('tx').client;
    const clash = await tx.query('select key, path from code_projects where key = $1 or lower(path) = lower($2)', [ok.key, ok.path]);
    if (clash.rows[0]) return c.json({ error: clash.rows[0].key === ok.key ? `There is already a project called "${ok.key}".` : `That folder is already the project "${clash.rows[0].key}".` }, 409);
    const row = await tx.query('insert into code_projects (workspace_id, key, path, default_branch, test_cmd, build_cmd) values ($1, $2, $3, $4, $5, $6) returning id, key, path, default_branch, test_cmd, build_cmd, created_at', [deps.workspaceId, ok.key, ok.path, ok.defaultBranch, ok.testCmd, ok.buildCmd]);
    return c.json(shape(row.rows[0]), 201);
  });

  // Removing a project takes it off the list. The folder is never touched.
  r.delete('/:key', async (c) => {
    const key = c.req.param('key');
    if (!PROJECT_KEY.test(key)) return c.json({ error: 'Not found' }, 404);
    const gone = await c.get('tx').client.query('delete from code_projects where key = $1', [key]);
    return gone.rowCount ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404);
  });

  return r;
}
