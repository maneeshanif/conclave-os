import { Hono, type Context } from 'hono';
import type { QueryResultRow } from 'pg';
import { z } from 'zod';
import type { AppEnv } from '../app';
import type { Bus } from '../bus';

const ACTOR = 'founder';
const Resolve = z.object({ note: z.string().trim().max(1000).optional() });

/**
 * What needs the founder (SPEC 11, 12). Recorded items (a question, a failed or unknown send) are rows and are
 * resolved by hand. Two kinds are derived from live state and have no row: a blocked task that nobody asked a
 * question about, and the kill switch while it is on. They clear themselves when the cause does, so they cannot be
 * resolved here. Resolving an item records who and when; it never unblocks or restarts anything.
 */
export function actionItemRoutes(deps: { workspaceId: string; bus: Bus }) {
  const r = new Hono<AppEnv>();
  const ws = deps.workspaceId;
  const q = async <T extends QueryResultRow>(c: Context<AppEnv>, sql: string, params: unknown[] = []) => (await c.get('tx').client.query<T>(sql, params)).rows;

  r.get('/', async (c) => {
    const status = c.req.query('status') === 'done' ? 'done' : 'open';
    const rows = await q<Record<string, unknown>>(
      c,
      `select id, kind, title, body, status, task_id, approval_id, created_at, resolved_at, resolved_by, resolution_note
         from action_items where status = $1 order by created_at desc, id desc limit 200`,
      [status],
    );
    if (status === 'done') return c.json(rows);

    // Blocked tasks without an open question, then the kill switch, ahead of the recorded items.
    const blocked = await q<{ id: string; title: string; blocked_reason: string | null; created_at: string }>(
      c,
      `select t.id, t.title, t.blocked_reason, t.created_at from tasks t
        where t.status = 'blocked'
          and not exists (select 1 from action_items a where a.task_id = t.id and a.status = 'open' and a.kind = 'question')
        order by t.created_at desc limit 100`,
    );
    const [ks] = await q<{ kill_switch: number; kill_switch_at: string | null }>(c, 'select kill_switch, kill_switch_at from workspace_settings');
    const derived: Record<string, unknown>[] = [];
    if (ks?.kill_switch === 1) {
      derived.push({
        id: 'kill-switch',
        kind: 'kill_switch',
        title: 'The kill switch is on',
        body: 'Everything is stopped. Turn it off in settings when you are ready; held emails then wait until you release them.',
        status: 'open',
        task_id: null,
        approval_id: null,
        created_at: ks.kill_switch_at,
        derived: true,
      });
    }
    for (const t of blocked) {
      derived.push({
        id: `task:${t.id}`,
        kind: 'blocked_task',
        title: `Blocked: ${t.title}`,
        body: t.blocked_reason,
        status: 'open',
        task_id: t.id,
        approval_id: null,
        created_at: t.created_at,
        derived: true,
      });
    }
    return c.json([...derived, ...rows]);
  });

  r.post('/:id/resolve', async (c) => {
    const parsed = Resolve.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => i.message).join('; ') }, 400);
    const id = c.req.param('id');
    const [item] = await q<{ status: string }>(c, 'select status from action_items where id = $1 for update', [id]);
    if (!item) return c.json({ error: 'Not found' }, 404);
    if (item.status !== 'open') return c.json({ error: 'This item was already resolved.' }, 409);
    await q(c, "update action_items set status = 'done', resolved_at = now(), resolved_by = $2, resolution_note = $3 where id = $1", [id, ACTOR, parsed.data.note ?? null]);
    await q(c, "insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'action_item.resolved', $3, $4)", [ws, ACTOR, id, JSON.stringify({ note: parsed.data.note ?? null })]);
    c.get('after').push(async () => deps.bus.publish({ kind: 'action_item.changed', workspaceId: ws, itemId: id }));
    return c.json({ id, status: 'done' });
  });

  return r;
}
