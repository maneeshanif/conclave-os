import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import type { Bus } from '../bus';
import { addSignal, dismissSignal, getSignal, normalizeUrl, promoteSignal, qualifySignal, signalView, SIGNAL_KINDS, SIGNAL_STATUSES, type Change, type SignalRow } from '../signals';

const ACTOR = 'founder';

const NewSignal = z.object({
  kind: z.enum(SIGNAL_KINDS),
  source: z.string().trim().min(1).max(100),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => {
      try {
        normalizeUrl(v);
        return true;
      } catch {
        return false;
      }
    }, 'must be a web address (http or https)'),
  author: z.string().trim().min(1).max(200).optional(),
  excerpt: z.string().max(5000).optional(),
});
const Qualify = z.object({ score: z.number().int().min(0).max(100).optional(), reason: z.string().trim().max(1000).optional() });
const Dismiss = z.object({ reason: z.string().trim().max(1000).optional() });
const List = z.object({
  status: z.enum(SIGNAL_STATUSES).optional(),
  kind: z.enum(SIGNAL_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** The signals API (S4-6): list, add by hand, qualify, dismiss, promote to a lead. Scouts add through the `os` tool instead. */
export function signalRoutes(deps: { workspaceId: string; bus: Bus }) {
  const r = new Hono<AppEnv>();
  const ws = deps.workspaceId;
  const bad = (c: { json: (b: unknown, s: 400) => Response }, e: z.ZodError) => c.json({ error: e.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, 400);
  const reply = (c: { json: (b: unknown, s?: 404 | 409) => Response }, ch: Change) => (ch.ok ? c.json(signalView(ch.signal)) : c.json({ error: ch.error }, ch.status));

  r.get('/', async (c) => {
    const parsed = List.safeParse(c.req.query());
    if (!parsed.success) return bad(c, parsed.error);
    const { status, kind, limit } = parsed.data;
    const rows = await c.get('tx').client.query<SignalRow>(
      `select id, kind, source, url, author, excerpt, status, score, reason, lead_id, found_by, found_at from signals
       where ($1::text is null or status = $1) and ($2::text is null or kind = $2) order by found_at desc, id limit $3`,
      [status ?? null, kind ?? null, limit],
    );
    return c.json(rows.rows.map(signalView));
  });

  r.get('/:id', async (c) => {
    const s = await getSignal(c.get('tx').client, c.req.param('id'));
    return s ? c.json(signalView(s)) : c.json({ error: 'Not found' }, 404);
  });

  r.post('/', async (c) => {
    const parsed = NewSignal.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return bad(c, parsed.error);
    const tx = c.get('tx').client;
    const out = await addSignal(tx, ws, parsed.data, ACTOR);
    const s = (await getSignal(tx, out.id))!;
    return out.created ? c.json(signalView(s), 201) : c.json({ ...signalView(s), duplicate: true }, 200);
  });

  r.post('/:id/qualify', async (c) => {
    const parsed = Qualify.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return bad(c, parsed.error);
    return reply(c, await qualifySignal(c.get('tx').client, ws, c.req.param('id'), ACTOR, parsed.data));
  });

  r.post('/:id/dismiss', async (c) => {
    const parsed = Dismiss.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return bad(c, parsed.error);
    return reply(c, await dismissSignal(c.get('tx').client, ws, c.req.param('id'), ACTOR, parsed.data.reason));
  });

  r.post('/:id/promote', async (c) => reply(c, await promoteSignal(c.get('tx').client, ws, c.req.param('id'), ACTOR)));

  return r;
}
