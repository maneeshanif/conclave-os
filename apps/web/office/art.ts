import type { Room } from '@conclave/shared';

/**
 * Picking the picture (SPEC 12). Which look, which frame and which colour, from facts about the figure. Pure, so it is tested
 * with no canvas; the scene only looks things up here. The layout matches `scripts/make-sprites.mjs`.
 */
export type Facing = 'down' | 'left' | 'right' | 'up';
export type Availability = 'available' | 'busy' | 'away';

const ROWS: Facing[] = ['down', 'left', 'right', 'up'];
export const FRAME = 32;
export const LOOKS = 6;
const PER_ROW = LOOKS * 3;

/** You are look 0; each agent gets one of 1 to 5 from its key, the same every time. */
export function lookFor(key: string | null): number {
  if (!key) return 0;
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 1 + (h % (LOOKS - 1));
}

/** The way to face for a move; the longer axis wins, and with no move you keep facing as you were. */
export function directionOf(dx: number, dy: number, was: Facing): Facing {
  if (dx === 0 && dy === 0) return was;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

/** Frame 0 when still; otherwise frame 1 or 2, switching every half tile walked. */
export function pose(moving: boolean, travelled: number): 0 | 1 | 2 {
  if (!moving) return 0;
  return Math.floor(travelled * 2) % 2 === 0 ? 1 : 2;
}

export function frameIndex(look: number, dir: Facing, frame: number): number {
  return ROWS.indexOf(dir) * PER_ROW + look * 3 + frame;
}

const PLACE: Record<string, string> = { desk: '#22c55e', approvals: '#f59e0b', boardroom: '#a855f7', lounge: '#94a3b8' };
/** The dot on an agent's name: working, waiting for you, in a discussion, or idle. */
export const placeColour = (place: string): string => PLACE[place] ?? '#94a3b8';

const AVAIL: Record<Availability, string> = { available: '#22c55e', busy: '#ef4444', away: '#f59e0b' };
/** The dot on your own name. */
export const availabilityColour = (a: Availability): string => AVAIL[a];

/** A wash of colour over a room, by what it is. Plain halls are left clear. */
export function roomTint(r: Room): { colour: number; alpha: number } | null {
  if (r.locked) return { colour: 0xdc2626, alpha: 0.18 };
  if (r.silent) return { colour: 0x3b82f6, alpha: 0.18 };
  if (r.kind === 'boardroom') return { colour: 0x7c3aed, alpha: 0.16 };
  if (r.kind === 'lounge') return { colour: 0x16a34a, alpha: 0.14 };
  if (r.kind === 'department' || r.kind === 'meeting') return { colour: 0x2563eb, alpha: 0.08 };
  return null;
}
