import { Hono, type Context } from 'hono';
import type { QueryResultRow } from 'pg';
import { z } from 'zod';
import { EmailPayload } from '../actions/email';
import { DmPayload } from '../actions/dm';
import { PostPayload } from '../actions/post';
import type { AppEnv } from '../app';
import type { Bus } from '../bus';

/** What the gate (S1-3) is told after a decision has committed. */
export interface ApprovalDecision {
  workspaceId: string;
  approvalId: string;
  approved: boolean;
}

export const APPROVAL_STATUSES = ['pending', 'approved', 'executing', 'executed', 'rejected', 'expired', 'failed'] as const;

/** Until login exists (S1-10) there is one person to decide. */
const DECIDER = 'founder';

const Decision = z.object({
  approved: z.boolean(),
  note: z.string().max(2000).optional(),
  editedPayload: z.record(z.string(), z.unknown()).optional(),
});

/** What a person may change on a card, by kind of approval. A kind not listed here cannot be edited. */
const EDITABLE: Record<string, readonly string[]> = {
  'email.send': ['subject', 'body'],
  'post.publish': ['text'],
  'dm.send': ['text'],
};

const LEAD_CARD = `(select jsonb_build_object('id', l.id, 'business_name', l.business_name, 'website', l.website,
                                              'email', l.email, 'stage', l.stage, 'notes', l.notes)
                    from leads l where l.id::text = a.payload ->> 'leadId')`;
const SELECT = `select a.id, a.kind, a.status, a.agent_id, ag.key as agent_key, a.task_id, a.payload, a.edited_payload,
                       a.decided_by, a.decided_at, a.decision_note, a.result, a.created_at,
                       case when a.kind = 'email.send' then ${LEAD_CARD} end as lead
                from approvals a left join agents ag on ag.id = a.agent_id`;

/**
 * The approvals API (SPEC 6, 11). A decision is one locked move from `pending` to `approved` or `rejected`
 * and never moves back. Approving here sends nothing: the gate (S1-3) hears about it after the commit and
 * the executor, plain code, does the rest.
 */
export function approvalRoutes(deps: { workspaceId: string; bus: Bus; onDecided?: (d: ApprovalDecision) => Promise<void> | void }) {
  const r = new Hono<AppEnv>();
  const ws = deps.workspaceId;
  const q = async <T extends QueryResultRow>(c: Context<AppEnv>, sql: string, params: unknown[] = []) => (await c.get('tx').client.query<T>(sql, params)).rows;
  const afterCommit = (c: Context<AppEnv>, fn: () => Promise<void>) => c.get('after').push(fn);

  r.get('/', async (c) => {
    const raw = c.req.query('status');
    let statuses: string[] | null = null;
    if (raw) {
      statuses = raw.split(',').map((s) => s.trim());
      const bad = statuses.find((s) => !(APPROVAL_STATUSES as readonly string[]).includes(s));
      if (bad) return c.json({ error: `Unknown status "${bad}". Known: ${APPROVAL_STATUSES.join(', ')}` }, 400);
    }
    return c.json(await q(c, `${SELECT} where ($1::text[] is null or a.status = any($1)) order by a.created_at desc, a.id desc limit 200`, [statuses]));
  });

  r.get('/:id', async (c) => {
    const [row] = await q(c, `${SELECT} where a.id = $1`, [c.req.param('id')]);
    return row ? c.json(row) : c.json({ error: 'Not found' }, 404);
  });

  r.post('/:id/decide', async (c) => {
    const parsed = Decision.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, 400);
    const { approved, note, editedPayload } = parsed.data;
    const id = c.req.param('id');

    // Lock the row: a second decision for the same approval waits here, then sees it is no longer pending.
    const [a] = await q<{ id: string; kind: string; status: string; payload: Record<string, unknown> }>(c, 'select id, kind, status, payload from approvals where id = $1 for update', [id]);
    if (!a) return c.json({ error: 'Not found' }, 404);
    if (a.status !== 'pending') return c.json({ error: `This approval was already decided (it is ${a.status}).`, status: a.status }, 409);

    let edited: Record<string, unknown> | null = null;
    if (approved && editedPayload !== undefined) {
      const allowed = EDITABLE[a.kind];
      if (!allowed) return c.json({ error: `A ${a.kind} approval cannot be edited. Approve it as it is, or reject it.` }, 400);
      const outside = Object.keys(editedPayload).filter((k) => !allowed.includes(k));
      if (outside.length) {
        return c.json({ error: `An edit can change only the ${allowed.join(' and the ')}, not the recipient, the lead or the step (${outside.join(', ')}).` }, 400);
      }
      const merged = a.kind === 'post.publish' ? PostPayload.safeParse({ ...a.payload, ...editedPayload }) : a.kind === 'dm.send' ? DmPayload.safeParse({ ...a.payload, ...editedPayload }) : EmailPayload.safeParse({ ...a.payload, ...editedPayload });
      if (!merged.success) return c.json({ error: merged.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
      edited = merged.data;
    }

    // With login on, say which device this came from (SPEC 12). The browser's own description, cut to a sane length.
    const device = c.get('owner') ? `${(c.req.header('user-agent') ?? 'unknown device').slice(0, 200)} (session ${c.get('owner')!.sessionId.slice(0, 8)})` : null;
    const status = approved ? 'approved' : 'rejected';
    await q(c, 'update approvals set status = $2, decided_by = $3, decided_at = now(), decision_note = $4, edited_payload = $5, decided_device = $6 where id = $1', [
      id,
      status,
      DECIDER,
      note ?? null,
      edited ? JSON.stringify(edited) : null,
      device,
    ]);
    if (!approved) await q(c, "update outreach_messages set status = 'rejected' where approval_id = $1 and status = 'queued'", [id]);
    await q(c, "update posts set status = $2 where approval_id = $1 and status = 'proposed'", [id, approved ? 'approved' : 'rejected']);
    await q(c, "update dms set status = $2 where approval_id = $1 and status = 'proposed'", [id, approved ? 'approved' : 'rejected']);
    await q(c, "update video_briefs set status = $2 where approval_id = $1 and status = 'pending_approval'", [id, approved ? 'approved' : 'rejected']);
    await q(c, "insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'approval.decided', $3, $4)", [
      ws,
      DECIDER,
      id,
      JSON.stringify({ kind: a.kind, approved, edited: edited !== null, ...(device ? { device } : {}) }),
    ]);

    afterCommit(c, async () => {
      deps.bus.publish({ kind: 'approval.changed', workspaceId: ws, approvalId: id, status });
      await deps.onDecided?.({ workspaceId: ws, approvalId: id, approved });
    });
    return c.json({ id, status });
  });

  return r;
}
