import type pg from 'pg';
import { monthStart } from './harness/budget';
import { RUNTIME_LABEL } from './harness/pauses';

/** What the last reaper pass did, kept in memory for the Health screen. Nothing depends on it. */
export class ReaperStatus {
  private last: { at: Date; reaped: number; requeued: number; blocked: number } | null = null;
  record(r: { reaped: unknown[]; requeued: unknown[]; blocked: unknown[] }, at = new Date()) {
    this.last = { at, reaped: r.reaped.length, requeued: r.requeued.length, blocked: r.blocked.length };
  }
  get() {
    return this.last;
  }
  clear() {
    this.last = null;
  }
}

const FAILED = ['failed', 'timed_out'];

/**
 * The Health screen's numbers (SPEC 12, 14), read from the tables: the queue, runs and failures by agent over a window,
 * spend against budget, open breakers, paused runtimes, the kill switch, the last reaper pass, and the database size.
 */
export async function buildHealth(c: pg.PoolClient, o: { hours: number; now?: Date; reaper?: ReaperStatus }) {
  const now = o.now ?? new Date();
  const since = new Date(now.getTime() - o.hours * 3_600_000);
  const rows = async <T extends object>(sql: string, p: unknown[] = []) => (await c.query<T>(sql, p)).rows;

  const [ks] = await rows<{ kill_switch: number; kill_switch_at: Date | null }>('select kill_switch, kill_switch_at from workspace_settings');
  const queue = { todo: 0, in_progress: 0, blocked: 0 };
  for (const r of await rows<{ status: keyof typeof queue; n: number }>("select status, count(*)::int as n from tasks where status in ('todo','in_progress','blocked') group by status")) queue[r.status] = r.n;

  const agents = await rows<{ id: string; key: string; name: string; budget: string; runs: number; failed: number; spent: string }>(
    `select a.id, a.key, a.name, a.monthly_budget_usd as budget,
            (select count(*)::int from runs r where r.agent_id = a.id and r.started_at >= $1) as runs,
            (select count(*)::int from runs r where r.agent_id = a.id and r.started_at >= $1 and r.status = any($2)) as failed,
            (select coalesce(sum(r.cost_usd), 0) from runs r where r.agent_id = a.id and r.started_at >= $3) as spent
       from agents a where a.status <> 'retired' order by a.key`,
    [since, FAILED, monthStart(now)],
  );

  const breakers = await rows<{ key: string; failures: number; last_error: string | null; opened_at: Date | null; open_until: Date | null }>(
    "select key, failures, last_error, opened_at, open_until from circuit_breakers where state = 'open' order by key",
  );
  const pauses = await rows<{ runtime: string; until: Date; reason: string }>('select runtime, until, reason from runtime_pauses where lifted_at is null and until > $1 order by until', [now]);
  const moved = await rows<{ agent: string; data: { from: string; to: string; reason: string }; at: Date }>(
    "select a.key as agent, e.data, e.at as at from run_events e join runs r on r.id = e.run_id join agents a on a.id = r.agent_id where e.type = 'reroute' and e.at >= $1 order by e.at desc limit 20",
    [since],
  );
  const [size] = await rows<{ bytes: string }>('select pg_database_size(current_database()) as bytes');
  const last = o.reaper?.get() ?? null;

  return {
    generatedAt: now.toISOString(),
    windowHours: o.hours,
    killSwitch: { on: ks?.kill_switch === 1, at: ks?.kill_switch_at?.toISOString() ?? null },
    queue,
    agents: agents.map((a) => {
      const spent = Number(a.spent);
      const budget = Number(a.budget);
      return {
        id: a.id,
        key: a.key,
        name: a.name,
        runs: a.runs,
        failed: a.failed,
        failureRate: a.runs ? a.failed / a.runs : null,
        spentThisMonth: spent,
        budget,
        overBudget: budget > 0 && spent >= budget,
      };
    }),
    breakers: breakers.map((b) => ({ key: b.key, failures: b.failures, lastError: b.last_error, openedAt: b.opened_at?.toISOString() ?? null, openUntil: b.open_until?.toISOString() ?? null })),
    pauses: pauses.map((p) => ({ runtime: p.runtime, label: RUNTIME_LABEL[p.runtime] ?? p.runtime, until: p.until.toISOString(), reason: p.reason })),
    reaper: last ? { at: last.at.toISOString(), reaped: last.reaped, requeued: last.requeued, blocked: last.blocked } : null,
    database: { sizeBytes: Number(size?.bytes ?? 0) },
    reroutes: moved.map((m) => ({ agent: m.agent, from: m.data.from, to: m.data.to, reason: m.data.reason, at: m.at.toISOString() })),
  };
}
