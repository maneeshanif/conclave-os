import { Hono, type Context } from 'hono';
import type { QueryResultRow } from 'pg';
import type { AppEnv } from '../app';
import { METRICS } from '../goals/metrics';

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

/**
 * The Goals screen's data (SPEC 3, 12). Read-only: the goals are the company file's (company/goals.yaml, copied into the
 * database when the server starts), so a change is an edit there, the same as for departments and agents. Progress is
 * measured from the tables by the metrics in src/goals/metrics.ts.
 */
export function goalRoutes() {
  const r = new Hono<AppEnv>();
  const q = async <T extends QueryResultRow>(c: Context<AppEnv>, sql: string, params: unknown[] = []) => (await c.get('tx').client.query<T>(sql, params)).rows;

  r.get('/goals', async (c) => {
    const client = c.get('tx').client;
    const now = new Date();
    const rows = await q<{ key: string; kind: string; title: string | null; metric: string | null; target: string | null; source: string | null; due: Date | null; status: string; parent_key: string | null; department: string | null }>(
      c,
      `select g.key, g.kind, g.title, g.metric, g.target, g.source, g.due, g.status, p.key as parent_key, d.key as department
         from goals g left join goals p on p.id = g.parent_id left join departments d on d.id = g.department_id
        where g.status <> 'retired'
        order by g.kind desc, g.due nulls last, g.key`,
    );

    const measure = async (metric: string | null, stage: string | null) => {
      const def = metric ? METRICS[metric] : undefined;
      return def ? { def, current: await def.compute(client, { stage }, now) } : null;
    };

    const rungs = [];
    const departments = [];
    for (const g of rows) {
      const target = g.target === null ? null : Number(g.target);
      if (g.kind === 'rung') {
        const m = await measure(g.metric, null);
        const current = m?.current ?? null;
        rungs.push({
          key: g.key,
          title: g.title,
          target,
          due: g.due ? g.due.toISOString().slice(0, 10) : null,
          status: g.status,
          source: g.source,
          unit: m?.def.unit ?? null,
          window: m?.def.window ?? null,
          measured: m !== null,
          current,
          pct: current !== null && target ? round((current / target) * 100) : null,
          met: current !== null && target !== null ? current >= target : false,
        });
      } else {
        const m = await measure(g.metric, g.source);
        const current = m?.current ?? null;
        departments.push({
          key: g.key,
          department: g.department,
          metric: g.metric,
          serves: g.parent_key,
          stage: g.source,
          target,
          unit: m?.def.unit ?? null,
          window: m?.def.window ?? null,
          measured: m !== null,
          current,
          pct: current !== null && target ? round((current / target) * 100) : null,
        });
      }
    }
    return c.json({ current_rung: rungs.find((x) => x.status === 'active')?.key ?? null, rungs, departments });
  });

  return r;
}
