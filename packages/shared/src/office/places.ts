import type { OfficeMap, Room } from './index';

/**
 * Where each agent stands (SPEC 12: agents move with their work). One function from facts the server reads out of runs, approvals
 * and discussions to a tile, so the world cannot disagree with the panels. Nothing here is set by hand.
 */
export type PlaceKind = 'desk' | 'approvals' | 'boardroom' | 'lounge';

export interface AgentFacts {
  agentId: string;
  /** The room it is seated in (S6-2), and its desk number, null if it has none. */
  room: string | null;
  desk: number | null;
  /** A run is going. */
  running: boolean;
  /** Something it proposed is waiting for a person to decide. */
  waitingForYou: boolean;
  /** It is in an open discussion. */
  inDiscussion: boolean;
}

export interface Placed {
  agentId: string;
  place: PlaceKind;
  reason: string;
  x: number;
  y: number;
}

const inRect = (r: Room, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/** Open tiles in a room, nearest to a point first, then in reading order, so the n-th agent always gets the n-th tile. */
function spotsIn(map: OfficeMap, room: Room | undefined, around: { x: number; y: number } | undefined): { x: number; y: number }[] {
  if (!room) return [];
  const busy = new Set([...map.desks.map((d) => `${d.x},${d.y}`), ...map.objects.map((o) => `${o.x},${o.y}`)]);
  const out: { x: number; y: number }[] = [];
  for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) if (!map.walls[y]![x] && !busy.has(`${x},${y}`)) out.push({ x, y });
  const c = around ?? { x: room.x + room.w / 2, y: room.y + room.h / 2 };
  return out.sort((a, b) => Math.abs(a.x - c.x) + Math.abs(a.y - c.y) - (Math.abs(b.x - c.x) + Math.abs(b.y - c.y)) || a.y - b.y || a.x - b.x);
}

export function placeAgents(map: OfficeMap, agents: AgentFacts[]): Placed[] {
  const lounge = map.rooms.find((r) => r.kind === 'lounge');
  const boardroom = map.rooms.find((r) => r.kind === 'boardroom');
  const hall = map.rooms.find((r) => r.kind === 'hall');
  const approvals = map.objects.find((o) => o.type === 'approvals-desk');
  const table = map.objects.find((o) => o.type === 'boardroom-table');
  const door = map.entries.find((e) => e.name === 'door');
  const spots: Record<'approvals' | 'boardroom' | 'lounge', { x: number; y: number }[]> = {
    approvals: spotsIn(map, hall ?? (approvals && map.rooms.find((r) => inRect(r, approvals.x, approvals.y))), approvals),
    boardroom: spotsIn(map, boardroom, table),
    lounge: spotsIn(map, lounge, map.entries.find((e) => e.name === 'lounge')),
  };
  const used = { approvals: 0, boardroom: 0, lounge: 0 };
  const next = (k: keyof typeof used): { x: number; y: number } => {
    const list = spots[k];
    const s = list.length ? list[used[k]++ % list.length]! : { x: (door ?? { x: 0 }).x, y: (door ?? { y: 0 }).y };
    return s;
  };

  // Sorted by id, so who gets which tile does not depend on the order the caller listed them in.
  const out: Placed[] = [];
  for (const a of [...agents].sort((p, q) => p.agentId.localeCompare(q.agentId))) {
    if (a.running) {
      const desk = a.desk !== null ? map.desks.find((d) => d.room === a.room && d.slot === a.desk) : undefined;
      const at = desk ? { x: desk.x, y: desk.y } : next('lounge'); // no desk: the lounge is where it works
      out.push({ agentId: a.agentId, place: 'desk', reason: 'Working on a task.', ...at });
    } else if (a.waitingForYou) {
      out.push({ agentId: a.agentId, place: 'approvals', reason: 'Waiting for you to decide.', ...next('approvals') });
    } else if (a.inDiscussion) {
      out.push({ agentId: a.agentId, place: 'boardroom', reason: 'In a Boardroom discussion.', ...next('boardroom') });
    } else {
      out.push({ agentId: a.agentId, place: 'lounge', reason: 'Idle.', ...next('lounge') });
    }
  }
  return out;
}
