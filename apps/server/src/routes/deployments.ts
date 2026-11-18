import { Hono } from 'hono';
import type { AppEnv } from '../app';

/** What is deployed where (S7-8, S7-9): every deployment, newest first. Read only; a deploy is an approved action, never made here. */
export function deploymentRoutes() {
  const r = new Hono<AppEnv>();
  r.get('/', async (c) => {
    const rows = await c.get('tx').client.query<{
      id: string;
      project_key: string;
      client: string | null;
      ref: string | null;
      status: string;
      url: string | null;
      error: string | null;
      approved_by: string;
      created_at: string;
      finished_at: string | null;
    }>('select id, project_key, client, ref, status, url, error, approved_by, created_at, finished_at from deployments order by created_at desc, id limit 200');
    return c.json({
      deployments: rows.rows.map((d) => ({ id: d.id, projectKey: d.project_key, client: d.client, ref: d.ref, status: d.status, url: d.url, error: d.error, approvedBy: d.approved_by, createdAt: d.created_at, finishedAt: d.finished_at })),
    });
  });
  return r;
}
