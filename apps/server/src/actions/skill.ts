import { writeFile } from 'node:fs/promises';
import { withWorkspace } from '../db/tenant';
import { runEval, type EvalCase } from '../research/improvements';
import { readSkill, skillFileFor, type SkillHome } from '../memory/skills';
import { readSettings } from '../settings';
import type { ExecResult, ExecutorDeps } from './email';

/**
 * The `skill.patch` executor (S8-3, SPEC 9). Plain code, no model. After a person approves a skill change it claims the approval once, checks
 * the file still reads exactly as it did when the change was proposed (else it fails and changes nothing), and writes the new text, whose
 * version is one higher. The old text stays in the approval and in git. A skill never changes silently.
 */
interface Payload {
  skill: string;
  owner: SkillHome['owner'];
  before: string;
  after: string;
  /** Set for an improvement from the Research room: its eval is run again here, and the patch is not written unless it passes. */
  evalCases?: EvalCase[];
}

export async function executeSkillPatch(deps: ExecutorDeps, approvalId: string): Promise<ExecResult> {
  const ws = deps.workspaceId;
  const claim = await withWorkspace(deps.pool, ws, async ({ client: c }) => {
    if ((await readSettings(c, ws)).killSwitch) return { kind: 'kill_switch' as const };
    const r = await c.query<{ payload: Payload; decided_by: string | null }>("update approvals set status = 'executing' where id = $1 and status = 'approved' and kind = 'skill.patch' returning payload, decided_by", [approvalId]);
    return r.rows[0] ? { kind: 'claimed' as const, payload: r.rows[0].payload, by: r.rows[0].decided_by ?? 'founder' } : { kind: 'none' as const };
  });
  if (claim.kind === 'kill_switch') return { status: 'kill_switch' };
  if (claim.kind === 'none') return { status: 'already_claimed' };
  const finish = async (ok: boolean, result: Record<string, unknown>) => {
    await withWorkspace(deps.pool, ws, async ({ client: c }) => {
      await c.query('update approvals set status = $2, result = $3 where id = $1', [approvalId, ok ? 'executed' : 'failed', JSON.stringify(result)]);
      if (!ok) await c.query("insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, 'executor_failed', 'A skill change was not applied', $2, $3) on conflict do nothing", [ws, `${String(result.reason)}\nNothing was changed. Ask for the change again if you still want it.`, approvalId]);
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'executor:skill', $2, $3, $4)", [ws, ok ? 'approval.executed' : 'approval.failed', approvalId, JSON.stringify(result)]);
    });
    deps.bus?.publish({ kind: 'approval.changed', workspaceId: ws, approvalId, status: ok ? 'executed' : 'failed' });
  };
  const fail = async (reason: string, status: 'refused' | 'failed'): Promise<ExecResult> => {
    await finish(false, { reason });
    return { status, reason };
  };
  const p = claim.payload;
  if (!deps.templatesRoot) return fail('this server has no templates folder to change', 'refused');
  const file = await skillFileFor(deps.templatesRoot, p.owner, p.skill);
  if (!file) return fail(`the skill "${p.skill}" is no longer there`, 'failed');
  if (p.evalCases) {
    const ev = runEval(p.after, p.evalCases);
    if (!ev.ok) return fail(`the eval no longer passes: ${ev.failures.join('; ')}`, 'failed');
  }
  try {
    if ((await readSkill(file)) !== p.before) return fail('the skill changed after it was proposed, so this patch no longer applies', 'failed');
    await writeFile(file, p.after, 'utf8');
    await finish(true, { skill: p.skill, owner: p.owner, approvedBy: claim.by });
    return { status: 'executed', ref: `skill:${p.skill}` };
  } catch (err) {
    return fail((err as Error).message, 'failed');
  }
}

/** On start: approved ones that never ran are applied; one left `executing` is failed with a note, and a person checks the file. */
export async function recoverSkills(deps: ExecutorDeps): Promise<{ resumed: string[]; unknown: string[] }> {
  const ws = deps.workspaceId;
  const { approved, executing } = await withWorkspace(deps.pool, ws, async ({ client: c }) => ({
    approved: (await c.query<{ id: string }>("select id from approvals where kind = 'skill.patch' and status = 'approved' order by decided_at, id")).rows.map((r) => r.id),
    executing: (await c.query<{ id: string }>("select id from approvals where kind = 'skill.patch' and status = 'executing'")).rows.map((r) => r.id),
  }));
  for (const id of executing) await withWorkspace(deps.pool, ws, ({ client: c }) => c.query("update approvals set status = 'failed', result = $2 where id = $1 and status = 'executing'", [id, JSON.stringify({ reason: 'interrupted; check the skill file' })]));
  const resumed: string[] = [];
  for (const id of approved) if ((await executeSkillPatch(deps, id)).status === 'executed') resumed.push(id);
  return { resumed, unknown: executing };
}

export async function releaseSkills(deps: ExecutorDeps): Promise<string[]> {
  const ids = await withWorkspace(deps.pool, deps.workspaceId, ({ client: c }) => c.query<{ id: string }>("select id from approvals where kind = 'skill.patch' and status = 'approved' order by decided_at, id"));
  const out: string[] = [];
  for (const { id } of ids.rows) if ((await executeSkillPatch(deps, id)).status === 'executed') out.push(id);
  return out;
}
