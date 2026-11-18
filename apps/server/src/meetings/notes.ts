import type pg from 'pg';
import { withWorkspace } from '../db/tenant';

/**
 * Consent and notes (S10-4, SPEC 10, 15). The Note Taker writes nothing down about a meeting unless everyone in it has said yes, and stops the
 * moment anyone takes that back or someone new joins who has not said yes. Consent, joining and withdrawing are each written to the audit
 * log, so who agreed and when is on record. What a note says is what was said: it is kept as data and never acted on.
 */
const log = (c: pg.PoolClient, workspaceId: string, action: string, meetingId: string, data: Record<string, unknown>) =>
  c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'meeting', $2, $3, $4)", [workspaceId, action, meetingId, JSON.stringify(data)]);

async function mustExist(c: pg.PoolClient, meetingId: string): Promise<{ status: string }> {
  const m = (await c.query<{ status: string }>('select status from meetings where id = $1', [meetingId])).rows[0];
  if (!m) throw new Error('There is no such meeting.');
  return m;
}

/** Someone is in the meeting. They have not said yes yet. Joining again changes nothing. */
export async function joinMeeting(pool: pg.Pool, workspaceId: string, meetingId: string, person: string): Promise<void> {
  const name = person.trim().slice(0, 100);
  if (!name) throw new Error('Give the person a name.');
  await withWorkspace(pool, workspaceId, async ({ client: c }) => {
    await mustExist(c, meetingId);
    const r = await c.query('insert into meeting_people (workspace_id, meeting_id, name) values ($1, $2, $3) on conflict (workspace_id, meeting_id, name) do nothing', [workspaceId, meetingId, name]);
    if (r.rowCount) await log(c, workspaceId, 'meeting.joined', meetingId, { person: name });
  });
}

async function setConsent(pool: pg.Pool, workspaceId: string, meetingId: string, person: string, give: boolean): Promise<void> {
  await withWorkspace(pool, workspaceId, async ({ client: c }) => {
    await mustExist(c, meetingId);
    const r = await c.query(
      give ? 'update meeting_people set consent_at = now(), withdrawn_at = null where meeting_id = $1 and name = $2' : 'update meeting_people set withdrawn_at = now() where meeting_id = $1 and name = $2 and consent_at is not null and withdrawn_at is null',
      [meetingId, person],
    );
    if (give && !r.rowCount) throw new Error(`${person} is not in this meeting.`);
    if (r.rowCount) await log(c, workspaceId, give ? 'meeting.consent_given' : 'meeting.consent_withdrawn', meetingId, { person });
  });
}

export const giveConsent = (pool: pg.Pool, workspaceId: string, meetingId: string, person: string) => setConsent(pool, workspaceId, meetingId, person, true);
export const withdrawConsent = (pool: pg.Pool, workspaceId: string, meetingId: string, person: string) => setConsent(pool, workspaceId, meetingId, person, false);

/** Has everyone in the meeting said yes, and not taken it back? Nobody in the meeting is not consent. */
export async function consentComplete(pool: pg.Pool, workspaceId: string, meetingId: string): Promise<{ ok: boolean; missing: string[] }> {
  const rows = (await withWorkspace(pool, workspaceId, ({ client: c }) => c.query<{ name: string; ok: boolean }>('select name, (consent_at is not null and withdrawn_at is null) as ok from meeting_people where meeting_id = $1 order by name', [meetingId]))).rows;
  if (!rows.length) return { ok: false, missing: [] };
  const missing = rows.filter((r) => !r.ok).map((r) => r.name);
  return { ok: missing.length === 0, missing };
}

/** Saves a note and its action items, if the meeting is open and everyone in it has consented. Otherwise nothing is saved, and the reason says who. */
export async function addMeetingNote(pool: pg.Pool, workspaceId: string, meetingId: string, n: { text: string; actionItems?: string[] }): Promise<{ id: string }> {
  const text = n.text.trim();
  if (!text) throw new Error('A note needs some text.');
  return withWorkspace(pool, workspaceId, async ({ client: c }) => {
    const m = await mustExist(c, meetingId);
    if (m.status !== 'open') throw new Error('That meeting is not open, so there is nothing to take notes of.');
    const people = (await c.query<{ name: string; ok: boolean }>('select name, (consent_at is not null and withdrawn_at is null) as ok from meeting_people where meeting_id = $1 order by name', [meetingId])).rows;
    if (!people.length) throw new Error('Nobody has joined this meeting, so there is no consent to take notes.');
    const missing = people.filter((p) => !p.ok).map((p) => p.name);
    if (missing.length) throw new Error(`No notes: consent is missing from ${missing.join(', ')}.`);
    const r = await c.query<{ id: string }>('insert into meeting_notes (workspace_id, meeting_id, text, action_items) values ($1, $2, $3, $4) returning id', [workspaceId, meetingId, text.slice(0, 5000), JSON.stringify((n.actionItems ?? []).map((a) => a.trim().slice(0, 300)).filter(Boolean).slice(0, 20))]);
    return { id: r.rows[0]!.id };
  });
}
