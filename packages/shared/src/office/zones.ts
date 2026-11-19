import type { OfficeMap, Room } from './index';
import type { Tile } from './walk';

/**
 * Zones and presence (SPEC 12; borrow audit A8). Who is where in the office, and what a room's own properties mean: a locked room
 * turns guests away, a room holds only so many, a silent room has no bubbles. Pure: the socket layer feeds it moves and sends on
 * the events it returns. Nothing here draws.
 */
export type Role = 'owner' | 'guest';
export type Availability = 'available' | 'busy' | 'away';
export type ZoneEvent = { kind: 'enter' | 'leave'; id: string; room: string };
export interface MoveResult {
  allowed: boolean;
  reason?: 'locked' | 'full';
  events: ZoneEvent[];
}
export interface PresenceRecord {
  id: string;
  role: Role;
  tile: Tile;
  room: string | null;
  availability: Availability;
  handRaised: boolean;
}

export class OfficePresence {
  private readonly people = new Map<string, PresenceRecord>();

  constructor(private readonly map: OfficeMap) {}

  roomAt(t: Tile): Room | null {
    return this.map.rooms.find((r) => t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h) ?? null;
  }

  /** Bubbles (the nearby chat and call) are off inside a silent room. */
  bubblesAllowed(t: Tile): boolean {
    return !this.roomAt(t)?.silent;
  }

  occupants(room: string): string[] {
    return [...this.people.values()].filter((p) => p.room === room).map((p) => p.id).sort();
  }

  private refusal(id: string, role: Role, target: Room | null, current: string | null): 'locked' | 'full' | null {
    if (!target || target.name === current) return null;
    if (target.locked && role !== 'owner') return 'locked';
    if (target.maxUsers !== null && this.occupants(target.name).filter((o) => o !== id).length >= target.maxUsers) return 'full';
    return null;
  }

  join(id: string, role: Role, tile: Tile): ZoneEvent[] {
    const target = this.roomAt(tile);
    const why = this.refusal(id, role, target, null);
    if (why) throw new Error(`cannot join: room "${target!.name}" is ${why}`);
    this.people.set(id, { id, role, tile: { ...tile }, room: target?.name ?? null, availability: 'available', handRaised: false });
    return target ? [{ kind: 'enter', id, room: target.name }] : [];
  }

  move(id: string, tile: Tile): MoveResult {
    const p = this.people.get(id);
    if (!p) throw new Error(`unknown person ${id}`);
    const target = this.roomAt(tile);
    const why = this.refusal(id, p.role, target, p.room);
    if (why) return { allowed: false, reason: why, events: [] };
    const events: ZoneEvent[] = [];
    const next = target?.name ?? null;
    if (next !== p.room) {
      if (p.room) events.push({ kind: 'leave', id, room: p.room });
      if (next) events.push({ kind: 'enter', id, room: next });
      p.handRaised = false;
    }
    p.room = next;
    p.tile = { ...tile };
    return { allowed: true, events };
  }

  leave(id: string): ZoneEvent[] {
    const p = this.people.get(id);
    this.people.delete(id);
    return p?.room ? [{ kind: 'leave', id, room: p.room }] : [];
  }

  setAvailability(id: string, a: Availability): void {
    const p = this.people.get(id);
    if (p) p.availability = a;
  }

  /** Only in a meeting room (a meeting or the Boardroom). False if you are not in one. */
  raiseHand(id: string, up: boolean): boolean {
    const p = this.people.get(id);
    const r = p?.room ? this.map.rooms.find((x) => x.name === p.room) : null;
    if (!p || !r || (r.kind !== 'meeting' && r.kind !== 'boardroom')) return false;
    p.handRaised = up;
    return true;
  }

  snapshot(): PresenceRecord[] {
    return [...this.people.values()].map((p) => ({ ...p, tile: { ...p.tile } })).sort((a, b) => a.id.localeCompare(b.id));
  }
}

/** What to tell someone who walks into a room, from the room's own properties. Null when there is nothing to say. */
export function zoneNotice(room: Room | null): string | null {
  if (!room) return null;
  const parts: string[] = [];
  if (room.locked) parts.push(`${room.name} is locked. Only the owner can come in.`);
  if (room.silent) parts.push('Quiet room: no bubbles open here.');
  if (room.maxUsers !== null) parts.push(`${room.name} holds up to ${room.maxUsers} ${room.maxUsers === 1 ? 'person' : 'people'}.`);
  return parts.length ? parts.join(' ') : null;
}
