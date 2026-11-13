import { Hono, type Context } from 'hono';
import type { QueryResultRow } from 'pg';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { EmailIn, suppress } from './leads';

const ACTOR = 'founder';

/** A whole domain is written as @example.com. It needs at least one dot. */
const DOMAIN = /^@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const Value = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => DOMAIN.test(v) || EmailIn.safeParse(v).success, 'must be an email address or a domain written as @example.com');

const Add = z.object({ value: Value, reason: z.string().trim().max(500).optional() });
const Remove = z.object({ reason: z.string().trim().min(3, 'say why it is being removed').max(500) });

/**
 * The suppression list (SPEC 10, 15): addresses and domains nobody may write to. Adding is easy and repeating it
 * changes nothing. Removing is never a side effect: it takes its own call with a reason, and both are logged.
 */
export function suppressionRoutes(deps: { workspaceId: string }) {
  const r = new Hono<AppEnv>();
  const ws = deps.workspaceId;
  const q = async <T extends QueryResultRow>(c: Context<AppEnv>, sql: string, params: unknown[] = []) => (await c.get('tx').client.query<T>(sql, params)).rows;
  const bad = (c: Context<AppEnv>, error: z.ZodError) => c.json({ error: error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, 400);

  r.get('/', async (c) => c.json(await q(c, 'select id, value, reason, added_at from suppression order by added_at desc, id desc')));

  r.post('/', async (c) => {
    const parsed = Add.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return bad(c, parsed.error);
    const { value, reason } = parsed.data;
    const created = await suppress(c.get('tx').client, ws, value, reason ?? 'added by hand');
    if (created) return c.json({ id: created, value }, 201);
    const [existing] = await q<{ id: string }>(c, 'select id from suppression where lower(value) = $1', [value]);
    return c.json({ id: existing?.id, value }, 200);
  });

  r.delete('/:id', async (c) => {
    const parsed = Remove.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return bad(c, parsed.error);
    const [row] = await q<{ id: string; value: string; reason: string | null }>(c, 'delete from suppression where id = $1 returning id, value, reason', [c.req.param('id')]);
    if (!row) return c.json({ error: 'Not found' }, 404);
    await q(c, "insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'suppression.removed', $3, $4)", [
      ws,
      ACTOR,
      row.id,
      JSON.stringify({ value: row.value, reason: parsed.data.reason, originalReason: row.reason }),
    ]);
    return c.json({ removed: row.value });
  });

  return r;
}
