import type { PoolClient } from 'pg';
import { METRICS } from './metrics';

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

export interface GoalProgress {
  target: number | null;
  unit: string | null;
  window: string | null;
  measured: boolean;
  current: number | null;
  pct: number | null;
}
export interface RungGoal extends GoalProgress {
  key: string;
  title: string | null;
  due: string | null;
  status: string;
  source: string | null;
  met: boolean;
}
export interface DepartmentGoal extends GoalProgress {
  key: string;
  department: string | null;
  metric: string | null;
  serves: string | null;
  stage: string | null;
}
export interface GoalsData {
  current_rung: string | null;
  rungs: RungGoal[];
  departments: DepartmentGoal[];
}

/**
 * Every goal with its progress, measured from the tables (S2-9). Shared by the Goals screen and the morning brief, so
 * the two can never disagree. A metric nothing can compute comes back as not measured, never as zero.
 */
export async function measureGoals(client: PoolClient, now: Date): Promise<GoalsData> {
  const rows = (
    await client.query<{ key: string; kind: string; title: string | null; metric: string | null; target: string | null; source: string | null; due: Date | null; status: string; parent_key: string | null; department: string | null }>(
      `select g.key, g.kind, g.title, g.metric, g.target, g.source, g.due, g.status, p.key as parent_key, d.key as department
         from goals g left join goals p on p.id = g.parent_id left join departments d on d.id = g.department_id
        where g.status <> 'retired'
        order by g.kind desc, g.due nulls last, g.key`,
    )
  ).rows;

  const measure = async (metric: string | null, stage: string | null) => {
    const def = metric ? METRICS[metric] : undefined;
    return def ? { def, current: await def.compute(client, { stage }, now) } : null;
  };

  const rungs: RungGoal[] = [];
  const departments: DepartmentGoal[] = [];
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
  return { current_rung: rungs.find((x) => x.status === 'active')?.key ?? null, rungs, departments };
}
