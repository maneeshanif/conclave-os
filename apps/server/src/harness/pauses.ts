import type pg from 'pg';
import { withWorkspace } from '../db/tenant';

export const DEFAULT_PAUSE_MS = 5 * 3_600_000;
const MAX_PAUSE_MS = 24 * 3_600_000;

export const RUNTIME_LABEL: Record<string, string> = { 'claude-cli': 'Claude Code', opencode: 'OpenCode', codex: 'Codex', 'openai-agents': 'the OpenAI Agents runtime' };
const label = (runtime: string) => RUNTIME_LABEL[runtime] ?? runtime;

/**
 * When a plan limit will reset, read from the runtime's message: Claude Code writes "...usage limit reached|<unix time>".
 * Anything missing, already past or more than a day away falls back to five hours, the length of a plan window.
 */
export function parseResetTime(message: string, now: Date): Date {
  const fallback = new Date(now.getTime() + DEFAULT_PAUSE_MS);
  const m = /\|\s*(\d{9,13})\b/.exec(message);
  if (!m) return fallback;
  const n = Number(m[1]);
  const at = new Date(n < 1e11 ? n * 1000 : n);
  const wait = at.getTime() - now.getTime();
  return wait > 0 && wait <= MAX_PAUSE_MS ? at : fallback;
}

/**
 * Pauses a runtime (SPEC 7, "Plan limits are part of the design"): every agent on it stops starting runs until the reset.
 * One pause per runtime at a time; a second limit while paused only keeps the later reset. The action item that tells the
 * founder is made once, with the pause.
 */
export async function pauseRuntime(c: pg.PoolClient, workspaceId: string, runtime: string, until: Date, message: string): Promise<{ created: boolean }> {
  const r = await c.query<{ created: boolean }>(
    `insert into runtime_pauses (workspace_id, runtime, until, reason) values ($1, $2, $3, $4)
     on conflict (workspace_id, runtime) where lifted_at is null
     do update set until = greatest(runtime_pauses.until, excluded.until), reason = excluded.reason
     returning (xmax = 0) as created`,
    [workspaceId, runtime, until, message.slice(0, 500)],
  );
  const created = r.rows[0]!.created;
  if (created) {
    await c.query("insert into action_items (workspace_id, kind, title, body) values ($1, 'runtime_paused', $2, $3)", [
      workspaceId,
      `${label(runtime)} is paused: its plan limit was reached`,
      `runtime: ${runtime}\nAgents on ${label(runtime)} will not start new runs until about ${until.toISOString().slice(0, 16).replace('T', ' ')} UTC, when the limit resets. Their tasks stay queued and carry on by themselves. You can lift the pause early from the Health screen. The runtime said: ${message.slice(0, 300)}`,
    ]);
    await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'system', 'runtime.paused', $2, $3)", [workspaceId, runtime, JSON.stringify({ until })]);
  }
  return { created };
}

export async function activePause(pool: pg.Pool, workspaceId: string, runtime: string, now: Date): Promise<{ until: Date; reason: string } | null> {
  const r = await withWorkspace(pool, workspaceId, ({ client: c }) => c.query<{ until: Date; reason: string }>('select until, reason from runtime_pauses where runtime = $1 and lifted_at is null and until > $2', [runtime, now]));
  return r.rows[0] ?? null;
}

/** Lifts a runtime's pause and closes its action item. False if there was nothing to lift. */
export async function liftPause(c: pg.PoolClient, workspaceId: string, runtime: string, by: string): Promise<boolean> {
  const r = await c.query("update runtime_pauses set lifted_at = now(), lifted_by = $3 where runtime = $2 and lifted_at is null and workspace_id = $1 returning id", [workspaceId, runtime, by]);
  if (!r.rows[0]) return false;
  await c.query("update action_items set status = 'done', resolved_at = now(), resolved_by = $2, resolution_note = 'The pause was lifted.' where kind = 'runtime_paused' and status = 'open' and body like $1", [`runtime: ${runtime}\n%`, by]);
  await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'runtime.resumed', $3, '{}')", [workspaceId, by, runtime]);
  return true;
}

/**
 * Lifts every pause whose reset time has come, and says which agents have work waiting so the caller can wake them. Run by
 * the ticker. A pause that has passed is already ignored when a run starts; this tidies the record and the action item.
 */
export async function liftExpiredPauses(o: { pool: pg.Pool; workspaceId: string; now?: () => Date }): Promise<{ lifted: string[]; agentsWithWork: string[] }> {
  const now = (o.now ?? (() => new Date()))();
  return withWorkspace(o.pool, o.workspaceId, async ({ client: c }) => {
    const due = await c.query<{ runtime: string }>('select runtime from runtime_pauses where lifted_at is null and until <= $1', [now]);
    const lifted: string[] = [];
    for (const { runtime } of due.rows) if (await liftPause(c, o.workspaceId, runtime, 'system')) lifted.push(runtime);
    if (!lifted.length) return { lifted, agentsWithWork: [] };
    const work = await c.query<{ id: string }>(
      "select a.id from agents a where a.status = 'active' and a.runtime = any($1) and exists (select 1 from tasks t where t.assignee_id = a.id and t.status = 'todo') order by a.created_at",
      [lifted],
    );
    return { lifted, agentsWithWork: work.rows.map((r) => r.id) };
  });
}
