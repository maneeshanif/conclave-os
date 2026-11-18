import type pg from 'pg';
import { loadTemplate } from '../harness/render';
import { withWorkspace } from '../db/tenant';

/**
 * How autonomous hiring may be (S8-6, SPEC 9). H0 is the default: nothing happens without a person. H1 may put a catalog hire on trial by
 * itself, inside a mandate: a catalog role, a department that is switched on, autonomy 0, a budget under the cap, no connector beyond `os`,
 * and room under the roster cap. Moving a trial agent to active stays a person's decision.
 */
export type HiringLevel = 'H0' | 'H1';

export interface HiringPolicy {
  level: HiringLevel;
  rosterCap: number;
  trialBudgetCapUsd: number;
}

export async function readHiring(pool: pg.Pool, workspaceId: string): Promise<HiringPolicy> {
  const r = await withWorkspace(pool, workspaceId, ({ client: c }) => c.query<{ hiring_level: string; roster_cap: number; trial_budget_cap_usd: string }>('select hiring_level, roster_cap, trial_budget_cap_usd from workspace_settings'));
  const row = r.rows[0];
  return { level: row?.hiring_level === 'H1' ? 'H1' : 'H0', rosterCap: row?.roster_cap ?? 20, trialBudgetCapUsd: Number(row?.trial_budget_cap_usd ?? 5) };
}

export async function setHiring(pool: pg.Pool, workspaceId: string, p: Partial<HiringPolicy>): Promise<void> {
  if (p.level && p.level !== 'H0' && p.level !== 'H1') throw new Error('The hiring level is H0 or H1. H2 comes later.');
  await withWorkspace(pool, workspaceId, async ({ client: c }) => {
    await c.query('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do nothing', [workspaceId]);
    await c.query('update workspace_settings set hiring_level = coalesce($1::text, hiring_level), roster_cap = coalesce($2::int, roster_cap), trial_budget_cap_usd = coalesce($3::numeric, trial_budget_cap_usd), updated_at = now()', [p.level ?? null, p.rosterCap ?? null, p.trialBudgetCapUsd ?? null]);
  });
}

/** Active agents against the cap. A benched (paused) agent costs nothing and does not count. */
export async function rosterRoom(pool: pg.Pool, workspaceId: string): Promise<{ active: number; cap: number; ok: boolean }> {
  const policy = await readHiring(pool, workspaceId);
  const active = Number((await withWorkspace(pool, workspaceId, ({ client: c }) => c.query<{ n: number }>("select count(*)::int as n from agents where status = 'active'"))).rows[0]!.n);
  return { active, cap: policy.rosterCap, ok: active < policy.rosterCap };
}

/**
 * Under H1, approves a pending hire that is inside the mandate, as `mandate:H1`, and says so in the audit log. A hire outside it is left for
 * a person, with the reason returned. Under H0 it does nothing.
 */
export async function tryAutoTrial(pool: pg.Pool, workspaceId: string, approvalId: string, templatesRoot: string | undefined): Promise<{ auto: boolean; reason?: string }> {
  const policy = await readHiring(pool, workspaceId);
  if (policy.level !== 'H1') return { auto: false, reason: 'the hiring level is H0: every hire comes to a person' };
  const a = (await withWorkspace(pool, workspaceId, ({ client: c }) => c.query<{ status: string; payload: { department: string; template: string; budgetUsd?: number; winner?: { source?: string } } }>("select status, payload from approvals where id = $1 and kind = 'hire'", [approvalId]))).rows[0];
  if (!a || a.status !== 'pending') return { auto: false, reason: 'not a pending hire' };
  const p = a.payload;
  if (!p.winner?.source) return { auto: false, reason: 'not a catalog role' };
  const dept = (await withWorkspace(pool, workspaceId, ({ client: c }) => c.query<{ active: boolean | null }>("select (room::jsonb->>'active')::boolean as active from departments where key = $1", [p.department]))).rows[0];
  if (!dept?.active) return { auto: false, reason: `the department "${p.department}" is not switched on` };
  if ((p.budgetUsd ?? 0) > policy.trialBudgetCapUsd) return { auto: false, reason: `the trial budget is above the cap of ${policy.trialBudgetCapUsd} dollars` };
  if (!templatesRoot) return { auto: false, reason: 'the server cannot check the template' };
  const t = await loadTemplate(templatesRoot, p.template).catch(() => null);
  if (!t) return { auto: false, reason: `there is no template "${p.template}"` };
  if (t.connectors.some((x) => x !== 'os')) return { auto: false, reason: 'the template needs a connector beyond os, which a mandate may not add' };
  if (!(await rosterRoom(pool, workspaceId)).ok) return { auto: false, reason: 'the roster is full' };
  await withWorkspace(pool, workspaceId, async ({ client: c }) => {
    const r = await c.query("update approvals set status = 'approved', decided_by = 'mandate:H1', decided_at = now(), decision_note = 'Inside the hiring mandate (H1)' where id = $1 and status = 'pending'", [approvalId]);
    if (r.rowCount) await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'mandate:H1', 'hire.auto_trial', $2, $3)", [workspaceId, approvalId, JSON.stringify({ department: p.department, template: p.template })]);
  });
  return { auto: true };
}
