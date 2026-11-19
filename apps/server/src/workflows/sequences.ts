import type pg from 'pg';
import type { Bus } from '../bus';
import { withWorkspace } from '../db/tenant';
import { readSettings, startOfToday } from '../settings';

export interface SequenceDeps {
  pool: pg.Pool;
  workspaceId: string;
  bus?: Bus;
  now?: () => Date;
}

const OPEN_TASK = "('todo','in_progress','waiting_approval','blocked')";

/**
 * The sequence runner (SPEC 10, 14). Plain code, no model. For each running campaign it finds the people whose next
 * step is due and makes one task per person for the outreach agent to draft that step. The draft still goes through
 * propose_email and an approval; this only decides who is due, and how many fit in the mailbox's day.
 *
 * Safe to run as often as you like: an enrolment remembers which step it has asked for (`requested_step`), the whole
 * pass is one transaction under a workspace lock (two runs at once take turns), and it does nothing while the kill
 * switch is on. Who is due: active, has an address, not do-not-contact, not suppressed, and the wait since the last
 * send has passed. How many: the mailbox's cap for today (smaller while warming up), less what it already sent today
 * and what is already on its way (open step tasks and emails waiting for approval or a send).
 */
export async function runSequences(deps: SequenceDeps): Promise<{ created: number; campaigns: Record<string, number> }> {
  const touched: string[] = [];
  const out = await withWorkspace(deps.pool, deps.workspaceId, ({ client }) => sequencePass(client, deps.workspaceId, (deps.now ?? (() => new Date()))(), touched));
  for (const taskId of touched) deps.bus?.publish({ kind: 'task.changed', workspaceId: deps.workspaceId, taskId });
  return { created: touched.length, campaigns: out };
}

/** One pass, on a connection that is already inside a workspace transaction. `touched` collects the ids of the tasks made. */
export async function sequencePass(c: pg.PoolClient, ws: string, now: Date, touched: string[]): Promise<Record<string, number>> {
  {
    const created: Record<string, number> = {};
    if ((await readSettings(c, ws)).killSwitch) return created;
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`sequence-run:${ws}`]);

    // Housekeeping. A founder's "no" (or an expired or failed send) on a step takes that person out of the queue,
    // because asking again would only meet the same refusal; and an enrolment with every step sent is finished.
    await c.query(
      `update sequence_enrollments e set status = 'paused', paused_reason = 'step ' || e.requested_step || ' was ' ||
         (select case a.status when 'rejected' then 'rejected' when 'expired' then 'not decided in time' else 'not sent' end
            from approvals a where a.kind = 'email.send' and a.dedupe_key = 'email:' || e.lead_id || ':' || e.requested_step limit 1)
        where e.status = 'active' and e.requested_step > e.steps_sent
          and exists (select 1 from approvals a where a.kind = 'email.send' and a.dedupe_key = 'email:' || e.lead_id || ':' || e.requested_step
                         and a.status in ('rejected','expired','failed'))`,
    );
    await c.query(
      `update sequence_enrollments e set status = 'done'
        where e.status = 'active' and e.steps_sent > 0
          and not exists (select 1 from sequence_steps s where s.campaign_id = e.campaign_id and s.step = e.steps_sent + 1)`,
    );

    const campaigns = await c.query<{ id: string; name: string; channel_account_id: string | null }>(
      "select id, name, channel_account_id from campaigns where status = 'running' and channel_account_id is not null order by created_at, id",
    );
    if (!campaigns.rows.length) return created;

    // The agent that drafts: an active outreach agent that may propose, the most trusted first.
    const agent = await c.query<{ id: string }>(
      `select a.id from agents a join departments d on d.id = a.department_id
        where d.key = 'outreach' and a.status = 'active' order by a.autonomy desc, a.created_at limit 1`,
    );
    const assignee = agent.rows[0]?.id ?? null;

    const room = new Map<string, number>(); // mailbox id -> how many more may be started today
    for (const camp of campaigns.rows) {
      const mb = camp.channel_account_id!;
      if (!room.has(mb)) {
        const r = await c.query<{ cap: number; used: number }>(
          `select case when ca.warmup_until is not null and ca.warmup_until >= $2::date then least(ca.warmup_cap, ca.daily_cap) else ca.daily_cap end as cap,
                  (select count(*)::int from outreach_messages m where m.channel_account_id = ca.id and m.status = 'sent' and m.sent_at >= $3)
                + (select count(*)::int from tasks t join campaigns k on k.id::text = substring(t.body from 'campaign ([0-9a-f-]{36})')
                    where t.kind = 'sequence_step' and t.status in ${OPEN_TASK} and k.channel_account_id = ca.id)
                + (select count(*)::int from approvals p join campaigns k on k.id::text = p.payload ->> 'campaignId'
                    where p.kind = 'email.send' and p.status in ('pending','approved','executing') and k.channel_account_id = ca.id) as used
             from channel_accounts ca where ca.id = $1 and ca.health = 'ok'`,
          [mb, localDate(now), startOfToday(now)],
        );
        room.set(mb, r.rows[0] ? Math.max(0, r.rows[0].cap - r.rows[0].used) : 0);
      }
      let left = room.get(mb)!;
      if (left <= 0) continue;

      const due = await c.query<{ id: string; lead_id: string; business_name: string | null; email: string; step: number; skill: string | null; template: string | null }>(
        `select e.id, e.lead_id, l.business_name, l.email, s.step, s.skill, s.template
           from sequence_enrollments e
           join leads l on l.id = e.lead_id
           join sequence_steps s on s.campaign_id = e.campaign_id and s.step = e.steps_sent + 1
          where e.campaign_id = $1 and e.status = 'active'
            and l.email is not null and l.verified and l.stage <> 'do_not_contact'
            and not exists (select 1 from suppression x where lower(x.value) = lower(l.email) or lower(x.value) = '@' || split_part(lower(l.email), '@', 2))
            and (e.steps_sent = 0 or e.last_sent_at + make_interval(days => s.wait_days) <= $2)
            and (
                  e.requested_step <= e.steps_sent
               or exists (select 1 from tasks t where t.id = e.step_task_id and t.status = 'cancelled')
               or (exists (select 1 from tasks t where t.id = e.step_task_id and t.status = 'done')
                   and not exists (select 1 from approvals a where a.kind = 'email.send' and a.dedupe_key = 'email:' || e.lead_id || ':' || s.step))
            )
          order by e.created_at, e.id`,
        [camp.id, now],
      );
      for (const d of due.rows) {
        if (left <= 0) break;
        const name = d.business_name ?? d.email;
        const body = [
          `Draft step ${d.step} of the campaign "${camp.name}" for ${name}.`,
          `Use ${d.skill ? `the ${d.skill} skill` : d.template ? `the ${d.template} template` : 'your outreach skill'}. Then call propose_email once with leadId ${d.lead_id}, step ${d.step} and campaignId ${camp.id}.`,
          `(campaign ${camp.id}, lead ${d.lead_id})`,
        ].join('\n');
        const t = await c.query<{ id: string }>(
          "insert into tasks (workspace_id, assignee_id, title, body, kind, subject_type, subject_id, created_by) values ($1, $2, $3, $4, 'sequence_step', 'enrollment', $5, 'system') returning id",
          [ws, assignee, `Step ${d.step} of "${camp.name}": ${name}`, body, d.id],
        );
        await c.query('update sequence_enrollments set requested_step = $2, step_task_id = $3 where id = $1', [d.id, d.step, t.rows[0]!.id]);
        touched.push(t.rows[0]!.id);
        created[camp.id] = (created[camp.id] ?? 0) + 1;
        left--;
      }
      room.set(mb, left);
    }
    return created;
  }
}

/** Today's date as the server's calendar sees it, written YYYY-MM-DD, for comparing with a warm-up date. */
function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
