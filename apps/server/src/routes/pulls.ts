import { Hono } from 'hono';
import type { AppEnv } from '../app';

/** Pull requests (jsm-hq's PR drawer, S7-6 and S7-7): read only, newest first, each with whether its tests passed and who approved it. Merging is an approved action, never made here. */
export function pullRoutes() {
  const r = new Hono<AppEnv>();
  r.get('/', async (c) => {
    const rows = await c.get('tx').client.query<{ id: string; project_key: string; number: number; title: string; summary: string; branch: string; base: string; head: string; status: string; connector: string; url: string | null; approved_by: string; merged_by: string | null; created_at: Date; merged_at: Date | null; tests_ok: string | null; merge_status: string | null }>(
      `select r.id, r.project_key, r.number, r.title, r.summary, r.branch, r.base, r.head, r.status, r.connector, r.url, r.approved_by, r.merged_by, r.created_at, r.merged_at,
              a.payload->'tests'->>'ok' as tests_ok,
              (select m.status from approvals m where m.kind = 'pr.merge' and m.dedupe_key = 'merge:' || r.project_key || ':' || r.number::text) as merge_status
         from code_pull_requests r left join approvals a on a.id = r.approval_id and a.workspace_id = r.workspace_id order by r.created_at desc, r.id limit 200`,
    );
    return c.json({
      pulls: rows.rows.map((p) => ({ id: p.id, project: p.project_key, number: p.number, title: p.title, summary: p.summary, branch: p.branch, base: p.base, head: p.head.slice(0, 12), status: p.status, connector: p.connector, url: p.url, approvedBy: p.approved_by, mergedBy: p.merged_by, createdAt: p.created_at.toISOString(), mergedAt: p.merged_at?.toISOString() ?? null, testsPassed: p.tests_ok === 'true', mergeRequest: p.merge_status })),
    });
  });
  return r;
}
