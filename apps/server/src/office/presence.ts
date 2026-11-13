import { z } from 'zod';

/**
 * Who is in the office with you, live (SPEC 12, 15). Signed-in sessions send where they are, whether they are available, and
 * whether a hand is up; everyone else's sessions are told. Nothing but those few fields is ever stored or forwarded, nothing is
 * written to the database, and a person who is not signed in never reaches this (the socket's login wall comes first).
 */
export type Availability = 'available' | 'busy' | 'away';
export interface PresenceMember {
  id: string;
  name: string;
  x: number;
  y: number;
  availability: Availability;
  handRaised: boolean;
}
export type PresenceMessage = { kind: 'presence'; member: PresenceMember } | { kind: 'presence.all'; members: PresenceMember[] } | { kind: 'presence.leave'; id: string };

const MAX_TILE = 500;
// Zod drops any key it does not list, so nothing else a client adds can be forwarded.
const Move = z.object({
  type: z.literal('presence'),
  x: z.number().int().min(0).max(MAX_TILE),
  y: z.number().int().min(0).max(MAX_TILE),
  availability: z.enum(['available', 'busy', 'away']),
  handRaised: z.boolean(),
  name: z.string().optional(),
});

const cleanName = (raw: string | undefined, was: string): string => {
  if (raw === undefined) return was;
  // eslint-disable-next-line no-control-regex
  const n = raw.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30).trim();
  return n || 'Guest';
};

interface Connection {
  id: string;
  send: (m: PresenceMessage) => void;
  member: PresenceMember | null;
  last: number | null;
}

export class PresenceHub {
  private readonly conns = new Set<Connection>();
  private readonly minIntervalMs: number;
  private readonly now: () => number;

  constructor(opts: { minIntervalMs?: number; now?: () => number } = {}) {
    this.minIntervalMs = opts.minIntervalMs ?? 100;
    this.now = opts.now ?? Date.now;
  }

  /** Everyone who has said where they are. */
  members(): PresenceMember[] {
    return [...this.conns].flatMap((c) => (c.member ? [{ ...c.member }] : []));
  }

  /** A signed-in session's socket. `id` is its session, so one person on two devices is two avatars. */
  connect(sessionId: string, send: (m: PresenceMessage) => void): { message(raw: unknown): void; close(): void } {
    const taken = new Set([...this.conns].map((c) => c.id));
    let id = sessionId;
    for (let n = 2; taken.has(id); n++) id = `${sessionId}~${n}`;
    const conn: Connection = { id, send, member: null, last: null };
    const here = this.members();
    this.conns.add(conn);
    if (here.length) send({ kind: 'presence.all', members: here });
    return {
      message: (raw) => this.receive(conn, raw),
      close: () => {
        this.conns.delete(conn);
        if (conn.member) this.tell({ kind: 'presence.leave', id: conn.id }, conn);
      },
    };
  }

  private receive(conn: Connection, raw: unknown): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      return;
    }
    const m = Move.safeParse(parsed);
    if (!m.success) return;
    const t = this.now();
    if (conn.last !== null && t - conn.last < this.minIntervalMs) return; // too soon: the next one will say where they are
    conn.last = t;
    conn.member = { id: conn.id, name: cleanName(m.data.name, conn.member?.name ?? 'Guest'), x: m.data.x, y: m.data.y, availability: m.data.availability, handRaised: m.data.handRaised };
    this.tell({ kind: 'presence', member: { ...conn.member } }, conn);
  }

  private tell(m: PresenceMessage, except: Connection): void {
    for (const c of this.conns) if (c !== except) c.send(m);
  }
}
