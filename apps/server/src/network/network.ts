import type pg from 'pg';
import { withWorkspace } from '../db/tenant';

/**
 * The Founder Network (S8-11b, SPEC 4): founders worth knowing, a note on each, message drafts in your voice, and reminders. The agents research
 * and draft; YOU send, from your own account, in your own words. So there is no send path here at all: a draft only becomes a touch when you
 * say you sent it yourself, and that is the only thing that sets the last touch and the next nudge.
 */
export interface Person {
  id: string;
  name: string;
  whereFound: string;
  note: string;
  status: string;
  lastTouch: string | null;
  nextNudge: string | null;
}

const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

export async function addPerson(pool: pg.Pool, workspaceId: string, p: { name: string; whereFound: string; note: string }): Promise<{ id: string; created: boolean }> {
  const name = p.name.trim().slice(0, 120);
  if (!name) throw new Error('A person needs a name.');
  return withWorkspace(pool, workspaceId, async ({ client: c }) => {
    const ins = await c.query<{ id: string }>(
      'insert into network_people (workspace_id, name, name_key, where_found, note) values ($1, $2, $3, $4, $5) on conflict (workspace_id, name_key) do nothing returning id',
      [workspaceId, name, key(name), p.whereFound.trim().slice(0, 500), p.note.trim().slice(0, 1500)],
    );
    if (ins.rows[0]) return { id: ins.rows[0].id, created: true };
    return { id: (await c.query<{ id: string }>('select id from network_people where name_key = $1', [key(name)])).rows[0]!.id, created: false };
  });
}

export async function addDraft(pool: pg.Pool, workspaceId: string, personId: string, text: string): Promise<string> {
  return withWorkspace(pool, workspaceId, async ({ client: c }) => {
    if (!(await c.query('select 1 from network_people where id = $1', [personId])).rows[0]) throw new Error('No such person.');
    return (await c.query<{ id: string }>('insert into network_drafts (workspace_id, person_id, text) values ($1, $2, $3) returning id', [workspaceId, personId, text.trim().slice(0, 3000)])).rows[0]!.id;
  });
}

/** You sent this draft yourself. It is the one thing that makes a touch: the last touch is now, and a nudge is set if you asked for one. Once only. */
export async function markSentByYou(pool: pg.Pool, workspaceId: string, draftId: string, nudgeInDays?: number): Promise<'ok' | 'not_found' | 'already'> {
  return withWorkspace(pool, workspaceId, async ({ client: c }) => {
    const d = (await c.query<{ person_id: string; status: string }>('select person_id, status from network_drafts where id = $1 for update', [draftId])).rows[0];
    if (!d) return 'not_found';
    if (d.status !== 'draft') return 'already';
    await c.query("update network_drafts set status = 'sent_by_you', sent_at = now() where id = $1", [draftId]);
    await c.query(
      "update network_people set status = 'in_touch', last_touch = now(), next_nudge = case when $2::int is null then next_nudge else to_char(current_date + $2::int, 'YYYY-MM-DD') end where id = $1",
      [d.person_id, nudgeInDays ?? null],
    );
    await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'founder', 'network.sent_by_you', $2, $3)", [workspaceId, d.person_id, JSON.stringify({ draftId })]);
    return 'ok';
  });
}

/** People still in touch whose nudge day (YYYY-MM-DD) has come. */
export async function dueNudges(pool: pg.Pool, workspaceId: string, today: string): Promise<Person[]> {
  const r = await withWorkspace(pool, workspaceId, ({ client: c }) =>
    c.query<{ id: string; name: string; where_found: string; note: string; status: string; last_touch: Date | null; next_nudge: string | null }>(
      "select id, name, where_found, note, status, last_touch, next_nudge from network_people where status = 'in_touch' and next_nudge is not null and next_nudge <= $1 order by next_nudge, name",
      [today],
    ),
  );
  return r.rows.map((x) => ({ id: x.id, name: x.name, whereFound: x.where_found, note: x.note, status: x.status, lastTouch: x.last_touch?.toISOString() ?? null, nextNudge: x.next_nudge }));
}
