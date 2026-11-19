import type pg from 'pg';
import { withWorkspace } from '../db/tenant';
import { publishMeetingToDeal } from './notes';

/**
 * Where a client meeting's video runs (S10-2, SPEC 10, 12). One interface, two implementations: a local stand-in that only records the room (no
 * video, nothing leaves the machine) and LiveKit behind a switch, which needs a media server a person has set up and is not tested here. The OS
 * itself never carries the video: the media side is a separate server, and a guest reaches only that.
 */
export interface MeetingConnector {
  readonly name: string;
  createRoom(i: { meetingId: string; title: string }): Promise<{ room: string }>;
  closeRoom(room: string): Promise<void>;
}

/** The stand-in: a room is a name. Nothing is run. */
export class LocalMeetingConnector implements MeetingConnector {
  readonly name = 'local';
  readonly rooms = new Set<string>();
  async createRoom(i: { meetingId: string }): Promise<{ room: string }> {
    const room = `local-${i.meetingId}`;
    this.rooms.add(room);
    return { room };
  }
  async closeRoom(room: string): Promise<void> {
    this.rooms.delete(room);
  }
}

/** LiveKit, through its server API. Not set up: it needs a server address and keys a person adds, and it is not tested. */
export class LiveKitConnector implements MeetingConnector {
  readonly name = 'livekit';
  async createRoom(): Promise<{ room: string }> {
    throw new Error('LiveKit is not set up. It needs a LiveKit server and its keys (docs/NEEDS-YOU.md). Use the local connector for now.');
  }
  async closeRoom(): Promise<void> {
    throw new Error('LiveKit is not set up.');
  }
}

/** `local` (the default) or `livekit`. Any other name is refused, so a typo cannot quietly pick the wrong one. */
export function selectMeetingConnector(name: string | undefined): MeetingConnector {
  if (name === undefined || name === '' || name === 'local') return new LocalMeetingConnector();
  if (name === 'livekit') return new LiveKitConnector();
  throw new Error(`Unknown meeting connector "${name}". Use "local" or "livekit".`);
}

export class MeetingStateError extends Error {}

/** Opens a planned meeting's room, once. Opening an open meeting returns its room and does not make another. */
export async function openMeeting(pool: pg.Pool, workspaceId: string, connector: MeetingConnector, meetingId: string): Promise<{ room: string; already: boolean }> {
  const m = (await withWorkspace(pool, workspaceId, ({ client: c }) => c.query<{ title: string; status: string; room: string | null }>('select title, status, room from meetings where id = $1', [meetingId]))).rows[0];
  if (!m) throw new MeetingStateError('There is no such meeting.');
  if (m.status === 'open' && m.room) return { room: m.room, already: true };
  if (m.status !== 'planned') throw new MeetingStateError(`That meeting is ${m.status}, so its room cannot be opened.`);
  const { room } = await connector.createRoom({ meetingId, title: m.title });
  // Only the first of two opens at once keeps its room: the update names the state it expects.
  const won = await withWorkspace(pool, workspaceId, ({ client: c }) => c.query("update meetings set status = 'open', room = $2 where id = $1 and status = 'planned'", [meetingId, room]));
  if (!won.rowCount) {
    await connector.closeRoom(room).catch(() => undefined);
    const now = (await withWorkspace(pool, workspaceId, ({ client: c }) => c.query<{ room: string | null }>('select room from meetings where id = $1', [meetingId]))).rows[0];
    return { room: now?.room ?? room, already: true };
  }
  return { room, already: false };
}

/** Closes an open meeting's room, once. Closing a closed meeting does nothing. */
export async function closeMeeting(pool: pg.Pool, workspaceId: string, connector: MeetingConnector, meetingId: string): Promise<{ closed: boolean }> {
  const m = (await withWorkspace(pool, workspaceId, ({ client: c }) => c.query<{ status: string; room: string | null }>('select status, room from meetings where id = $1', [meetingId]))).rows[0];
  if (!m) throw new MeetingStateError('There is no such meeting.');
  if (m.status !== 'open' || !m.room) return { closed: false };
  const won = await withWorkspace(pool, workspaceId, ({ client: c }) => c.query("update meetings set status = 'closed' where id = $1 and status = 'open'", [meetingId]));
  if (!won.rowCount) return { closed: false };
  await connector.closeRoom(m.room);
  // A finished meeting puts its notes and action items on its deal, once (S10-5).
  await publishMeetingToDeal(pool, workspaceId, meetingId).catch((err) => console.error('could not put the meeting notes on the deal:', (err as Error).message));
  return { closed: true };
}
