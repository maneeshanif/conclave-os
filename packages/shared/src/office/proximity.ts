import type { Tile } from './walk';

/**
 * Walking up to an agent (SPEC 12). Within `near` tiles the agent's drawer opens; it closes only past `far` tiles, so standing on
 * the edge does not make it flicker. One drawer at a time: the nearest agent, ties to the lower id. A drawer opened from the agent
 * list is "pinned" and stays until closed. Pure; nothing draws.
 */
export type ProximityEvent = { kind: 'open' | 'close'; id: string };

export class Proximity {
  private target: string | null = null;
  private pinned = false;

  constructor(
    private readonly near: number,
    private readonly far: number,
  ) {
    if (far < near) throw new Error('far must be at least near');
  }

  get current(): string | null {
    return this.target;
  }

  update(me: Tile, agents: { id: string; tile: Tile }[]): ProximityEvent[] {
    if (this.pinned) return [];
    const dist = (t: Tile) => Math.hypot(t.x - me.x, t.y - me.y);
    const held = this.target ? agents.find((a) => a.id === this.target) : undefined;
    const keep = held && dist(held.tile) <= this.far;
    const best = agents
      .filter((a) => dist(a.tile) <= this.near)
      .sort((a, b) => dist(a.tile) - dist(b.tile) || a.id.localeCompare(b.id))[0];
    // Keep the open drawer while in the far range, unless someone else is now clearly the nearest within the near range.
    const next = best && (!keep || (best.id !== this.target && dist(best.tile) < dist(held!.tile))) ? best.id : keep ? this.target : null;
    return this.switchTo(next);
  }

  open(id: string): ProximityEvent[] {
    const events = this.switchTo(id);
    this.pinned = true;
    return events;
  }

  close(): ProximityEvent[] {
    this.pinned = false;
    return this.switchTo(null);
  }

  private switchTo(next: string | null): ProximityEvent[] {
    if (next === this.target) return [];
    const events: ProximityEvent[] = [];
    if (this.target) events.push({ kind: 'close', id: this.target });
    if (next) events.push({ kind: 'open', id: next });
    this.target = next;
    return events;
  }
}
