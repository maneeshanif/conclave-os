import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withWorkspace } from '../db/tenant';
import { readSettings } from '../settings';
import { assetKey, extFor, type Shot } from '../video/briefs';
import type { ExecResult, ExecutorDeps } from './email';

/**
 * The video generation executor (SPEC 8). Plain code, no model. An approved brief is the permission to spend credits on
 * generation, up to the credits counted from its shot list. It claims the approval once, then calls the generation connector
 * once per image or clip, stores each asset by key in the data folder, and stops at the first failure or the first asset that
 * would take it over the approved credits. A generation is never retried: it costs credits and a retry could pay twice.
 */
export async function executeVideoBrief(deps: ExecutorDeps, approvalId: string): Promise<ExecResult> {
  const ws = deps.workspaceId;

  const claim = await withWorkspace(deps.pool, ws, async ({ client: c }) => {
    if ((await readSettings(c, ws)).killSwitch) return { kind: 'kill_switch' as const };
    const r = await c.query<{ payload: { briefId?: string } }>("update approvals set status = 'executing' where id = $1 and status = 'approved' and kind = 'video.brief' returning payload", [approvalId]);
    if (!r.rows[0]) return { kind: 'none' as const };
    await c.query("update video_briefs set status = 'generating' where approval_id = $1", [approvalId]);
    return { kind: 'claimed' as const, briefId: r.rows[0].payload?.briefId };
  });
  if (claim.kind === 'kill_switch') return { status: 'kill_switch' };
  if (claim.kind === 'none') return { status: 'already_claimed' };

  const finish = async (ok: boolean, brief: 'generated' | 'failed', result: Record<string, unknown>, spent: number, ideaId?: string, item?: { title: string; body: string }) => {
    await withWorkspace(deps.pool, ws, async ({ client: c }) => {
      await c.query('update approvals set status = $2, result = $3 where id = $1', [approvalId, ok ? 'executed' : 'failed', JSON.stringify(result)]);
      await c.query('update video_briefs set status = $2, spent_credits = $3, error = $4 where approval_id = $1', [approvalId, brief, spent, ok ? null : String(result.reason ?? '')]);
      if (ok && ideaId) await c.query("update video_ideas set stage = 'assets', updated_at = now() where id = $1 and stage = 'brief'", [ideaId]);
      if (item) await c.query("insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, 'executor_failed', $2, $3, $4) on conflict do nothing", [ws, item.title, item.body, approvalId]);
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'executor:video', $2, $3, $4)", [ws, ok ? 'approval.executed' : 'approval.failed', approvalId, JSON.stringify(result)]);
    });
    deps.bus?.publish({ kind: 'approval.changed', workspaceId: ws, approvalId, status: ok ? 'executed' : 'failed' });
  };
  const fail = async (reason: string, spent: number, ideaId: string | undefined, assets: number): Promise<ExecResult> => {
    await finish(false, 'failed', { reason, credits: spent, assets }, spent, ideaId, { title: 'A video brief could not be generated', body: `${reason}\nCredits spent: ${spent}. Nothing was retried, so nothing is paid for twice. Assets made so far are kept.` });
    return { status: 'failed', reason };
  };

  const brief = await withWorkspace(deps.pool, ws, async ({ client: c }) => (await c.query<{ id: string; idea_id: string; shots: Shot[]; estimated_credits: number }>('select id, idea_id, shots, estimated_credits from video_briefs where approval_id = $1', [approvalId])).rows[0]);
  if (!brief) {
    await finish(false, 'failed', { reason: 'the brief no longer exists' }, 0);
    return { status: 'refused', reason: 'the brief no longer exists' };
  }
  const generator = deps.generator;
  if (!generator || !deps.dataDir) {
    const reason = 'there is no generation connector set up on this server, so nothing can be generated. Choose a generator and connect it, then approve a new copy of the brief.';
    await finish(false, 'failed', { reason }, 0, brief.idea_id, { title: 'A video brief was approved but cannot be generated', body: reason });
    return { status: 'refused', reason };
  }

  let spent = 0;
  let made = 0;
  for (const [i, shot] of brief.shots.entries()) {
    if (shot.kind === 'text') continue; // drawn by the assembly code
    const n = i + 1;
    let asset;
    try {
      asset = await generator.generate({ kind: shot.kind, description: shot.description, seconds: shot.seconds });
    } catch (err) {
      return fail(`generating shot ${n} failed: ${(err as Error).message}`, spent, brief.idea_id, made);
    }
    spent += asset.credits;
    // The approval is for a number of credits. An asset that takes the total past it is not kept, and nothing more is generated.
    if (spent > brief.estimated_credits) return fail(`shot ${n} cost ${asset.credits} credits, which takes the brief to ${spent}, more credits than approved (${brief.estimated_credits})`, spent, brief.idea_id, made);
    const key = assetKey(brief.id, n, extFor(asset.mime));
    await mkdir(path.dirname(path.join(deps.dataDir, key)), { recursive: true });
    await writeFile(path.join(deps.dataDir, key), asset.content);
    await withWorkspace(deps.pool, ws, ({ client: c }) =>
      c.query('insert into video_assets (workspace_id, brief_id, shot, kind, key, mime, credits) values ($1, $2, $3, $4, $5, $6, $7)', [ws, brief.id, n, shot.kind, key, asset.mime, asset.credits]),
    );
    made++;
  }
  await finish(true, 'generated', { credits: spent, assets: made, connector: generator.name }, spent, brief.idea_id);
  return { status: 'executed', ref: `video:${brief.id}` };
}

/** On start: a brief left generating may have spent credits and made some assets, so it is never generated again; it is marked failed and raised. */
export async function recoverVideo(deps: ExecutorDeps): Promise<{ resumed: string[]; unknown: string[] }> {
  const ws = deps.workspaceId;
  const { approved, executing } = await withWorkspace(deps.pool, ws, async ({ client: c }) => ({
    approved: (await c.query<{ id: string }>("select id from approvals where kind = 'video.brief' and status = 'approved' order by decided_at, id")).rows.map((r) => r.id),
    executing: (await c.query<{ id: string }>("select id from approvals where kind = 'video.brief' and status = 'executing'")).rows.map((r) => r.id),
  }));
  for (const id of executing) {
    await withWorkspace(deps.pool, ws, async ({ client: c }) => {
      await c.query("update approvals set status = 'failed', result = $2 where id = $1 and status = 'executing'", [id, JSON.stringify({ reason: 'interrupted while generating; credits may have been spent' })]);
      await c.query("update video_briefs set status = 'failed', error = 'interrupted while generating; credits may have been spent' where approval_id = $1", [id]);
      await c.query("insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, 'send_unknown', 'A video was being generated when the server stopped', 'Credits may have been spent and some assets made. It was not generated again. Check the generator, then approve a new brief if you want it redone.', $2) on conflict do nothing", [ws, id]);
    });
  }
  for (const id of approved) await executeVideoBrief(deps, id);
  return { resumed: approved, unknown: executing };
}

export async function releaseVideo(deps: ExecutorDeps): Promise<string[]> {
  const ids = await withWorkspace(deps.pool, deps.workspaceId, ({ client: c }) => c.query<{ id: string }>("select id from approvals where kind = 'video.brief' and status = 'approved' order by decided_at, id"));
  const released: string[] = [];
  for (const { id } of ids.rows) if ((await executeVideoBrief(deps, id)).status === 'executed') released.push(id);
  return released;
}
