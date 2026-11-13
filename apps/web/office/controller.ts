import { OfficePresence, Proximity, Walker, nearestReachable, stepFrom, type Direction, type OfficeMap, type ProximityEvent, type Tile } from '@conclave/shared';

/**
 * The world without the drawing (SPEC 12). It owns your avatar, every agent's walker, who is near whom and which room you are in,
 * and is told the time (`tick`) and what happened (`setAgents`, `click`, `key`). The Phaser scene only reads it and draws. Keeping
 * it apart means it can be tested with no browser and no canvas, and the drawing stays a thin skin (CLAUDE.md: Phaser only inside
 * apps/web/office).
 */
export interface AgentSpot {
  agentId: string;
  x: number;
  y: number;
}
export interface Options {
  /** Tiles per second for you and for agents. */
  speed?: number;
  agentSpeed?: number;
  near?: number;
  far?: number;
}
const ME = 'me';

export class WorldController {
  readonly me: Walker;
  readonly presence: OfficePresence;
  private readonly proximity: Proximity;
  private readonly walkers = new Map<string, { walker: Walker; target: Tile }>();
  private readonly listeners: ((e: ProximityEvent) => void)[] = [];
  private visible = true;
  private lastTile: Tile;

  constructor(
    private readonly map: OfficeMap,
    private readonly opts: Options = {},
  ) {
    const door = map.entries.find((e) => e.name === 'door') ?? map.entries[0] ?? { x: 1, y: 1 };
    this.me = new Walker(map, door, opts.speed ?? 5);
    this.presence = new OfficePresence(map);
    this.presence.join(ME, 'owner', door);
    this.lastTile = { x: door.x, y: door.y };
    this.proximity = new Proximity(opts.near ?? 1.5, opts.far ?? 2.5);
  }

  get running(): boolean {
    return this.visible;
  }

  /** Called with every drawer open or close. */
  onDrawer(fn: (e: ProximityEvent) => void): void {
    this.listeners.push(fn);
  }

  /** The agents with where they are now, for the scene to draw. */
  agents(): { id: string; position: { x: number; y: number } }[] {
    return [...this.walkers.entries()].map(([id, w]) => ({ id, position: w.walker.position })).sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Where the server says each agent is. A new one appears there; one that is already here walks to its new place. */
  setAgents(spots: AgentSpot[]): void {
    const now = new Set(spots.map((s) => s.agentId));
    for (const id of [...this.walkers.keys()]) if (!now.has(id)) this.walkers.delete(id);
    for (const s of spots) {
      const target = { x: s.x, y: s.y };
      const have = this.walkers.get(s.agentId);
      if (!have) {
        this.walkers.set(s.agentId, { walker: new Walker(this.map, target, this.opts.agentSpeed ?? 3), target });
      } else if (have.target.x !== target.x || have.target.y !== target.y) {
        have.target = target;
        if (this.visible) have.walker.walkTo(target);
        else have.walker.teleport(target);
      }
    }
  }

  /** A click on the floor: walk there, or to the nearest open tile if it was a wall. */
  click(t: Tile): boolean {
    const to = nearestReachable(this.map, this.me.tile, t);
    return to ? this.me.walkTo(to) : false;
  }

  /** An arrow key: one step, from the tile you are on. */
  key(dir: Direction): void {
    this.me.walkTo(stepFrom(this.map, this.me.tile, dir));
  }

  openDrawer(id: string): void {
    this.emit(this.proximity.open(id));
  }

  closeDrawer(): void {
    this.emit(this.proximity.close());
  }

  /** A hidden tab does not move anything; showing it again puts every agent where it should be without a long walk. */
  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    if (v) for (const w of this.walkers.values()) w.walker.teleport(w.target);
  }

  tick(dtMs: number): void {
    if (!this.visible) return;
    this.me.tick(dtMs);
    for (const w of this.walkers.values()) w.walker.tick(dtMs);
    const t = this.me.tile;
    if (t.x !== this.lastTile.x || t.y !== this.lastTile.y) {
      this.presence.move(ME, t);
      this.lastTile = t;
    }
    this.emit(this.proximity.update(this.me.position, this.agents().map((a) => ({ id: a.id, tile: a.position }))));
  }

  private emit(events: ProximityEvent[]): void {
    for (const e of events) for (const fn of this.listeners) fn(e);
  }
}
