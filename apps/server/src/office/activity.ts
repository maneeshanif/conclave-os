import type pg from 'pg';

export interface ActivityEvent {
  id: string;
  at: string;
  kind: string;
  text: string;
}

/** What an approval is, in a few words, for a sentence. */
const NOUN = "(case ap.kind when 'email.send' then 'an email' when 'post.publish' then 'a post' when 'dm.send' then 'a direct message' when 'video.brief' then 'a video brief' when 'agent.create' then 'adding an agent' else ap.kind end)";

/**
 * What just happened in the office (S6-14b3): the latest events, newest first, each as one plain sentence, read from the tables the
 * other screens use (runs, approvals, handoff messages, department channels), so it can never say anything they do not. Carries no
 * ids that mean anything to a person, and nothing from another company (row-level security applies to every table here).
 */
export async function activityFeed(c: pg.PoolClient, limit = 20): Promise<ActivityEvent[]> {
  const r = await c.query<{ id: string; at: Date; kind: string; text: string }>(
    `select id, at, kind, text from (
       select r.id::text || ':start' as id, r.started_at as at, 'run.started' as kind, a.name || ' started a run.' as text
         from runs r join agents a on a.id = r.agent_id where r.started_at is not null
       union all
       select r.id::text || ':end', r.ended_at, 'run.ended',
              case when r.status = 'succeeded' then a.name || ' finished a run.' else a.name || '''s run did not finish: ' || r.status || '.' end
         from runs r join agents a on a.id = r.agent_id where r.ended_at is not null
       union all
       select ap.id::text || ':asked', ap.created_at, 'approval.asked',
              case when ap.kind = 'agent.create' then 'You proposed adding ' || coalesce(ap.payload->>'name', ap.payload->>'id', 'an agent') || ' to ' || coalesce(ap.payload->>'department', 'a department') || '.'
                   else coalesce(a.name, 'Someone') || ' asked you to approve ' || ${NOUN} || '.' end
         from approvals ap left join agents a on a.id = ap.agent_id
       union all
       select ap.id::text || ':decided', ap.decided_at, 'approval.decided',
              'You ' || case when ap.status = 'rejected' then 'rejected' else 'approved' end || ' ' || ${NOUN} || '.'
         from approvals ap where ap.decided_at is not null and ap.status in ('approved', 'executing', 'executed', 'failed', 'rejected')
       union all
       select m.id::text, m.created_at, 'task.handoff', fa.name || ' handed a task to ' || ta.name || '.'
         from messages m join agents fa on 'agent:' || fa.key = m.from_id join agents ta on 'agent:' || ta.key = m.to_id where fa.id <> ta.id
       union all
       select dm.id::text, dm.created_at, 'channel.message',
              case when dm.author = 'founder' then 'You' else coalesce(fa.name, dm.author) end || ' said in ' || d.name || ': ' || left(dm.body, 80)
         from department_messages dm join departments d on d.id = dm.department_id left join agents fa on 'agent:' || fa.key = dm.author
     ) e order by at desc, id limit $1`,
    [limit],
  );
  return r.rows.map((e) => ({ id: e.id, at: new Date(e.at).toISOString(), kind: e.kind, text: e.text }));
}
