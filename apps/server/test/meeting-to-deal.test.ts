import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withWorkspace } from '../src/db/tenant';
import { closeMeeting, LocalMeetingConnector, openMeeting } from '../src/meetings/connector';
import { addMeetingNote, giveConsent, joinMeeting, publishMeetingToDeal } from '../src/meetings/notes';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

/** Notes and action items on the deal (S10-5): a finished meeting puts them there once. */
let sys: System;
let dealId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const connector = new LocalMeetingConnector();

/** An open meeting on the deal, with one person who has agreed. */
async function meeting(title: string, deal: string | null = dealId) {
  const id = (await sql("insert into meetings (workspace_id, deal_id, title, starts_at) values ($1, $2, $3, now()) returning id", [ws(), deal, title])).rows[0].id as string;
  await openMeeting(sys.app, ws(), connector, id);
  await joinMeeting(sys.app, ws(), id, 'Dana');
  await giveConsent(sys.app, ws(), id, 'Dana');
  return id;
}
const onDeal = async () => (await sql("select title, body, kind, status, created_by from tasks where subject_type = 'deal' and subject_id = $1 order by kind, title", [dealId])).rows;

beforeAll(async () => {
  ({ sys } = await testSystem());
  const account = (await sql("insert into accounts (workspace_id, name) values ($1, 'Glow Clinic') returning id", [ws()])).rows[0].id as string;
  dealId = (await sql("insert into deals (workspace_id, account_id) values ($1, $2) returning id", [ws(), account])).rows[0].id as string;
}, 240_000);
afterAll(() => sys?.close());

describe('meeting notes on the deal (S10-5)', () => {
  it('puts one note and one task per action item on the deal when the meeting closes, with the meeting as the source', async () => {
    const m = await meeting('Kickoff');
    await addMeetingNote(sys.app, ws(), m, { text: 'They want a faster booking page.', actionItems: ['Send three examples', 'Book a follow-up'] });
    await addMeetingNote(sys.app, ws(), m, { text: 'Budget is not fixed yet.', actionItems: ['Send three examples'] });
    expect(await onDeal()).toEqual([]);
    expect(await closeMeeting(sys.app, ws(), connector, m)).toEqual({ closed: true });
    const rows = await onDeal();
    expect(rows).toHaveLength(3);
    const note = rows.find((r) => r.kind === 'meeting_notes')!;
    expect(note).toMatchObject({ title: 'Notes: Kickoff', status: 'done', created_by: 'note-taker' });
    expect(note.body).toContain(`meeting "Kickoff" (${m})`);
    expect(note.body).toMatch(/faster booking page/);
    expect(note.body).toMatch(/Budget is not fixed/);
    expect(rows.filter((r) => r.kind === 'meeting_action').map((r) => r.title).sort()).toEqual(['Book a follow-up', 'Send three examples']);
    expect(rows.filter((r) => r.kind === 'meeting_action').every((r) => r.status === 'todo' && r.body.includes(m))).toBe(true);
    expect((await sql("select count(*)::int as n from audit_log where action = 'meeting.published' and subject = $1", [m])).rows[0].n).toBe(1);
  });

  it('happens once, even if asked again or at the same moment', async () => {
    const m = await meeting('Once only');
    await addMeetingNote(sys.app, ws(), m, { text: 'One thing.', actionItems: ['Do it'] });
    await closeMeeting(sys.app, ws(), connector, m);
    const before = (await onDeal()).length;
    const again = await Promise.all([publishMeetingToDeal(sys.app, ws(), m), publishMeetingToDeal(sys.app, ws(), m)]);
    expect(again).toEqual([{ published: false, tasks: 0 }, { published: false, tasks: 0 }]);
    expect((await onDeal()).length).toBe(before);
  });

  it('publishes nothing for a meeting with no deal, with no notes, or that is not closed', async () => {
    const before = (await onDeal()).length;
    const noDeal = await meeting('No deal', null);
    await addMeetingNote(sys.app, ws(), noDeal, { text: 'x' });
    await closeMeeting(sys.app, ws(), connector, noDeal);
    const noNotes = await meeting('No notes');
    await closeMeeting(sys.app, ws(), connector, noNotes);
    const open = await meeting('Still open');
    await addMeetingNote(sys.app, ws(), open, { text: 'y' });
    expect(await publishMeetingToDeal(sys.app, ws(), open)).toEqual({ published: false, tasks: 0 });
    expect((await onDeal()).length).toBe(before);
    expect((await sql('select published_at from meetings where id = $1', [noDeal])).rows[0].published_at).toBeNull();
  });
});
