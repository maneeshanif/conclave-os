import type { OfficeMap } from './index';

/**
 * Walking (SPEC 12; borrow audit A8). A grid you walk one tile at a time, in four directions, never through a wall. The path finder
 * is a breadth-first search with a fixed order of neighbours, so the same walk is always the same path. Nothing here draws.
 */
export interface Tile {
  x: number;
  y: number;
}
export type Direction = 'up' | 'down' | 'left' | 'right';

const STEPS: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const key = (t: Tile) => t.y * 100_000 + t.x;
const open = (m: OfficeMap, x: number, y: number) => x >= 0 && y >= 0 && x < m.width && y < m.height && !m.walls[y]![x];

/** The shortest path from one tile to another, both included; null if either is a wall or there is no way. */
export function findPath(m: OfficeMap, from: Tile, to: Tile): Tile[] | null {
  if (!open(m, from.x, from.y) || !open(m, to.x, to.y)) return null;
  const came = new Map<number, Tile | null>([[key(from), null]]);
  const queue: Tile[] = [from];
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i]!;
    if (t.x === to.x && t.y === to.y) {
      const path: Tile[] = [];
      for (let p: Tile | null = t; p; p = came.get(key(p)) ?? null) path.push({ x: p.x, y: p.y });
      return path.reverse();
    }
    for (const [dx, dy] of STEPS) {
      const n = { x: t.x + dx, y: t.y + dy };
      if (open(m, n.x, n.y) && !came.has(key(n))) {
        came.set(key(n), t);
        queue.push(n);
      }
    }
  }
  return null;
}

/** Where a click should take you: the tile itself if you can reach it, else the reachable tile closest to it. Null only if you cannot stand anywhere. */
export function nearestReachable(m: OfficeMap, from: Tile, target: Tile): Tile | null {
  if (!open(m, from.x, from.y)) return null;
  if (open(m, target.x, target.y) && findPath(m, from, target)) return { x: target.x, y: target.y };
  const seen = new Set<number>([key(from)]);
  const queue: Tile[] = [from];
  let best = from;
  let bestD = Math.abs(from.x - target.x) + Math.abs(from.y - target.y);
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i]!;
    const d = Math.abs(t.x - target.x) + Math.abs(t.y - target.y);
    if (d < bestD) {
      best = t;
      bestD = d;
    }
    for (const [dx, dy] of STEPS) {
      const n = { x: t.x + dx, y: t.y + dy };
      if (open(m, n.x, n.y) && !seen.has(key(n))) {
        seen.add(key(n));
        queue.push(n);
      }
    }
  }
  return { x: best.x, y: best.y };
}

/** One arrow-key step. You stay where you are if the next tile is a wall or off the map. */
export function stepFrom(m: OfficeMap, from: Tile, dir: Direction): Tile {
  const [dx, dy] = dir === 'up' ? STEPS[0]! : dir === 'right' ? STEPS[1]! : dir === 'down' ? STEPS[2]! : STEPS[3]!;
  return open(m, from.x + dx, from.y + dy) ? { x: from.x + dx, y: from.y + dy } : { x: from.x, y: from.y };
}

/** Something that walks a path at a steady speed, moving smoothly between tiles. Your avatar and every agent use one. */
export class Walker {
  private path: Tile[] = [];
  /** How far along the path, in tiles. */
  private progress = 0;
  private start: Tile;

  constructor(
    private readonly map: OfficeMap,
    from: Tile,
    /** Tiles per second. */
    private readonly speed: number,
  ) {
    this.start = { x: from.x, y: from.y };
  }

  /** The tile it is on (the last one it fully reached). */
  get tile(): Tile {
    const i = Math.min(Math.floor(this.progress + 1e-9), Math.max(this.path.length - 1, 0));
    return this.path.length ? { ...this.path[i]! } : { ...this.start };
  }

  /** Where it is, between tiles. */
  get position(): { x: number; y: number } {
    if (!this.path.length) return { ...this.start };
    const i = Math.min(Math.floor(this.progress), this.path.length - 1);
    const a = this.path[i]!;
    const b = this.path[Math.min(i + 1, this.path.length - 1)]!;
    const f = i >= this.path.length - 1 ? 0 : this.progress - i;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }

  get arrived(): boolean {
    return this.path.length === 0 || this.progress >= this.path.length - 1 - 1e-9;
  }

  /** Starts walking to a tile from where it is. False, and it stays put, if there is no way. */
  walkTo(to: Tile): boolean {
    const frac = this.progress - Math.floor(this.progress + 1e-9);
    if (this.path.length && !this.arrived && frac > 1e-6) {
      // Part way through a step: finish it, then go on to the new place, so the figure does not jump back to the tile it left.
      const i = Math.floor(this.progress);
      const here = this.path[i]!;
      const next = this.path[i + 1]!;
      const rest = findPath(this.map, next, to);
      if (!rest) return false;
      this.start = here;
      this.path = [here, ...rest];
      this.progress = frac;
      return true;
    }
    const here = this.tile;
    const path = findPath(this.map, here, to);
    if (!path) return false;
    this.start = here;
    this.path = path;
    this.progress = 0;
    return true;
  }

  /** Stops at the end of the step it is on (a held key let go). */
  stop(): void {
    if (this.arrived) return;
    const keep = Math.min(Math.ceil(this.progress - 1e-9), this.path.length - 1);
    this.path = this.path.slice(0, keep + 1);
  }

  teleport(to: Tile): void {
    this.start = { x: to.x, y: to.y };
    this.path = [];
    this.progress = 0;
  }

  tick(dtMs: number): void {
    if (this.arrived) return;
    this.progress = Math.min(this.progress + (this.speed * dtMs) / 1000, this.path.length - 1);
  }
}
