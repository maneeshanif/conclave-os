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
  /** Which of the six looks, 0 to 5. */
  look: number;
  x: number;
  y: number;
  availability: Availability;
  handRaised: boolean;
}
export const LOOKS = 6;
export interface ChatMessage {
  kind: 'chat';
  id: string;
  name: string;
  text: string;
  at: number;
}
export type PresenceMessage = { kind: 'presence'; member: PresenceMember } | { kind: 'presence.all'; members: PresenceMember[] } | { kind: 'presence.leave'; id: string } | ChatMessage;

/** Text reaches only the people this many tiles from the sender (S6-15c). No audio, no video. */
export const CHAT_RANGE = 5;
const MAX_CHAT = 300;

const MAX_TILE = 500;
// Zod drops any key it does not list, so nothing else a client adds can be forwarded.
const Move = z.object({
  type: z.literal('presence'),
  x: z.number().int().min(0).max(MAX_TILE),
  y: z.number().int().min(0).max(MAX_TILE),
  availability: z.enum(['available', 'busy', 'away']),
  handRaised: z.boolean(),
  name: z.string().optional(),
  // Not checked here: a bad look keeps the last good one instead of dropping the whole move.
  look: z.unknown().optional(),
});
const goodLook = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < LOOKS;

const Chat = z.object({ type: z.literal('chat'), text: z.string() });
const cleanText = (raw: string): string =>
  // eslint-disable-next-line no-control-regex
  raw.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT);

const cleanName = (raw: string | undefined, was: string): string => {
  if (raw === undefined) return was;
  // eslint-disable-next-line no-control-regex
  const n = raw.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30).trim();
  return n || 'Guest';
};

interface Connection {
  id: string;
  /** The world this socket is in (the headquarters by default). Nobody hears or sees anyone in another. */
  world: string;
  send: (m: PresenceMessage) => void;
  member: PresenceMember | null;
  last: number | null;
  lastChat: number | null;
}

export class PresenceHub {
  private readonly conns = new Set<Connection>();
  private readonly minIntervalMs: number;
  private readonly chatIntervalMs: number;
  private readonly now: () => number;

  constructor(opts: { minIntervalMs?: number; chatIntervalMs?: number; now?: () => number } = {}) {
    this.minIntervalMs = opts.minIntervalMs ?? 100;
    this.chatIntervalMs = opts.chatIntervalMs ?? 500;
    this.now = opts.now ?? Date.now;
  }

  /** Everyone who has said where they are. */
  members(world?: string): PresenceMember[] {
    return [...this.conns].filter((c) => world === undefined || c.world === world).flatMap((c) => (c.member ? [{ ...c.member }] : []));
  }

  /** A signed-in session's socket. `id` is its session, so one person on two devices is two avatars. */
  connect(sessionId: string, send: (m: PresenceMessage) => void, world = 'hq'): { message(raw: unknown): void; close(): void } {
    const taken = new Set([...this.conns].map((c) => c.id));
    let id = sessionId;
    for (let n = 2; taken.has(id); n++) id = `${sessionId}~${n}`;
    const conn: Connection = { id, world, send, member: null, last: null, lastChat: null };
    const here = this.members(world);
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
    const chat = Chat.safeParse(parsed);
    if (chat.success) return this.say(conn, chat.data.text);
    const m = Move.safeParse(parsed);
    if (!m.success) return;
    const t = this.now();
    if (conn.last !== null && t - conn.last < this.minIntervalMs) return; // too soon: the next one will say where they are
    conn.last = t;
    conn.member = { id: conn.id, name: cleanName(m.data.name, conn.member?.name ?? 'Guest'), look: goodLook(m.data.look) ? m.data.look : (conn.member?.look ?? 0), x: m.data.x, y: m.data.y, availability: m.data.availability, handRaised: m.data.handRaised };
    this.tell({ kind: 'presence', member: { ...conn.member } }, conn);
  }

  /** A line of text from someone who has said where they are: only people within range hear it, and never the sender. */
  private say(conn: Connection, raw: string): void {
    const from = conn.member;
    if (!from) return;
    const text = cleanText(raw);
    if (!text) return;
    const t = this.now();
    if (conn.lastChat !== null && t - conn.lastChat < this.chatIntervalMs) return;
    conn.lastChat = t;
    const msg: ChatMessage = { kind: 'chat', id: from.id, name: from.name, text, at: t };
    for (const c of this.conns) {
      if (c === conn || !c.member || c.world !== conn.world) continue;
      if (Math.hypot(c.member.x - from.x, c.member.y - from.y) <= CHAT_RANGE) c.send(msg);
    }
  }

  private tell(m: PresenceMessage, except: Connection): void {
    for (const c of this.conns) if (c !== except && c.world === except.world) c.send(m);
  }
}
