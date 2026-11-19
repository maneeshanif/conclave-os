import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withWorkspace } from '../src/db/tenant';
import { closeMeeting, LiveKitConnector, LocalMeetingConnector, MeetingStateError, openMeeting, selectMeetingConnector, type MeetingConnector } from '../src/meetings/connector';
import { openGuestLink } from '../src/meetings/guest';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

/** The meeting connector (S10-2): rooms open and close once, and the real connector is never used unless switched on. */
let sys: System;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const meeting = async (title: string) => (await sql("insert into meetings (workspace_id, title, starts_at) values ($1, $2, now() + interval '1 hour') returning id", [ws(), title])).rows[0].id as string;

class Counting extends LocalMeetingConnector {
  created = 0;
  closed = 0;
  override async createRoom(i: { meetingId: string; title: string }) {
    this.created++;
    return super.createRoom(i);
  }
  override async closeRoom(room: string) {
    this.closed++;
    return super.closeRoom(room);
  }
}

beforeAll(async () => {
  ({ sys } = await testSystem());
}, 240_000);
afterAll(() => sys?.close());

describe('the meeting connector (S10-2)', () => {
  it('opens a planned meeting once, records its room, and a second open returns the same room without making another', async () => {
    const c = new Counting();
    const id = await meeting('Kickoff');
    const first = await openMeeting(sys.app, ws(), c, id);
    expect(first).toEqual({ room: `local-${id}`, already: false });
    expect((await sql('select status, room from meetings where id = $1', [id])).rows[0]).toEqual({ status: 'open', room: `local-${id}` });
    expect(await openMeeting(sys.app, ws(), c, id)).toEqual({ room: `local-${id}`, already: true });
    expect(c.created).toBe(1);
    expect(c.rooms.has(`local-${id}`)).toBe(true);
  });

  it('two opens at the same moment make one room that stays, and the loser takes its room away again', async () => {
    const c = new Counting();
    const id = await meeting('Race');
    const [a, b] = await Promise.all([openMeeting(sys.app, ws(), c, id), openMeeting(sys.app, ws(), c, id)]);
    expect(a.room).toBe(b.room);
    expect([a.already, b.already].filter((x) => !x)).toHaveLength(1);
    expect(c.rooms.size).toBe(1);
    expect((await sql('select status from meetings where id = $1', [id])).rows[0].status).toBe('open');
  });

  it('closes an open meeting once, and closing again or closing a planned one does nothing', async () => {
    const c = new Counting();
    const id = await meeting('Wrap up');
    expect(await closeMeeting(sys.app, ws(), c, id)).toEqual({ closed: false }); // planned: nothing to close
    await openMeeting(sys.app, ws(), c, id);
    expect(await closeMeeting(sys.app, ws(), c, id)).toEqual({ closed: true });
    expect(await closeMeeting(sys.app, ws(), c, id)).toEqual({ closed: false });
    expect(c.closed).toBe(1);
    expect(c.rooms.size).toBe(0);
    await expect(openMeeting(sys.app, ws(), c, id)).rejects.toThrow(MeetingStateError);
    await expect(openMeeting(sys.app, ws(), c, '00000000-0000-4000-8000-000000000000')).rejects.toThrow(/no such meeting/);
  });

  it('a guest link stops working when the meeting closes', async () => {
    const { newGuestToken } = await import('../src/meetings/guest');
    const id = await meeting('Ends');
    const t = newGuestToken(ws());
    await sql("insert into guest_links (workspace_id, meeting_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '1 day')", [ws(), id, t.hash]);
    const c = new Counting();
    await openMeeting(sys.app, ws(), c, id);
    expect(await openGuestLink(sys.app, t.token)).not.toBeNull();
    await closeMeeting(sys.app, ws(), c, id);
    expect(await openGuestLink(sys.app, t.token)).toBeNull();
  });

  it('is the local stand-in unless livekit is switched on by name, and livekit says it is not set up', async () => {
    expect(selectMeetingConnector(undefined)).toBeInstanceOf(LocalMeetingConnector);
    expect(selectMeetingConnector('local')).toBeInstanceOf(LocalMeetingConnector);
    const lk: MeetingConnector = selectMeetingConnector('livekit');
    expect(lk).toBeInstanceOf(LiveKitConnector);
    await expect(lk.createRoom({ meetingId: 'x', title: 't' })).rejects.toThrow(/not set up/);
    expect(() => selectMeetingConnector('zoom')).toThrow(/Unknown meeting connector/);
    // A failing connector leaves the meeting planned, not half open.
    const id = await meeting('Not yet');
    await expect(openMeeting(sys.app, ws(), lk, id)).rejects.toThrow(/not set up/);
    expect((await sql('select status, room from meetings where id = $1', [id])).rows[0]).toEqual({ status: 'planned', room: null });
  });
});
