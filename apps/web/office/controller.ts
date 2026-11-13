import { OfficePresence, Proximity, Walker, nearestReachable, stepFrom, type Direction, type OfficeMap, type ProximityEvent, type Room, type Tile } from '@conclave/shared';

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
export interface Other {
  id: string;
  name: string;
  x: number;
  y: number;
  availability: 'available' | 'busy' | 'away';
  handRaised: boolean;
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
  private held: Direction | null = null;
  private readonly others_ = new Map<string, { walker: Walker; target: Tile; who: Other }>();
  private readonly moveListeners: ((t: Tile) => void)[] = [];
  private readonly zoneListeners: ((room: Room | null) => void)[] = [];
  private viewW = 0;
  private viewH = 0;
  private level = 2;
  private zoomBeforeOverview: number | null = null;

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

  /** The size of the drawing area, so the lowest zoom can be "the whole map fits". */
  setViewport(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    this.level = this.clamp(this.level);
  }

  private get fit(): number {
    return this.viewW && this.viewH ? Math.min(this.viewW / (this.map.width * this.map.tile), this.viewH / (this.map.height * this.map.tile)) : 0.25;
  }

  private clamp(z: number): number {
    const lo = this.fit;
    return Math.max(lo, Math.min(Math.max(3, lo), z));
  }

  /** How far in the camera is: about twice by default, never past 3, never further out than the whole map. */
  get zoom(): number {
    return this.level;
  }

  zoomIn(): void {
    this.zoomBeforeOverview = null;
    this.level = this.clamp(this.level * 1.25);
  }

  zoomOut(): void {
    this.zoomBeforeOverview = null;
    this.level = this.clamp(this.level / 1.25);
  }

  /** The whole map at once, and back again. */
  overview(on: boolean): void {
    if (on) {
      if (this.zoomBeforeOverview === null) this.zoomBeforeOverview = this.level;
      this.level = this.fit;
    } else if (this.zoomBeforeOverview !== null) {
      this.level = this.clamp(this.zoomBeforeOverview);
      this.zoomBeforeOverview = null;
    }
  }

  /** A direction key held down (or null when let go): walk that way until a wall, and stop on a whole tile at release. */
  hold(dir: Direction | null): void {
    this.held = dir;
    if (!dir) this.me.stop();
    else this.run(dir);
  }

  private run(dir: Direction): void {
    let t = this.me.tile;
    for (;;) {
      const n = stepFrom(this.map, t, dir);
      if (n.x === t.x && n.y === t.y) break;
      t = n;
    }
    const here = this.me.tile;
    if (t.x !== here.x || t.y !== here.y) this.me.walkTo(t);
  }

  get running(): boolean {
    return this.visible;
  }

  /** Called with every drawer open or close. */
  onDrawer(fn: (e: ProximityEvent) => void): void {
    this.listeners.push(fn);
  }

  /** Called when the room you are in changes (null when you step out into open floor). */
  onZone(fn: (room: Room | null) => void): void {
    this.zoneListeners.push(fn);
  }

  /** Called each time you reach a new tile, so the page can tell the others where you are. */
  onMove(fn: (t: Tile) => void): void {
    this.moveListeners.push(fn);
  }

  /** Other people in the office now, from the server's presence. A new one appears where they are; one already here walks. */
  setOthers(list: Other[]): void {
    const now = new Set(list.map((o) => o.id));
    for (const id of [...this.others_.keys()]) if (!now.has(id)) this.others_.delete(id);
    for (const o of list) {
      const target = { x: o.x, y: o.y };
      const have = this.others_.get(o.id);
      if (!have) {
        this.others_.set(o.id, { walker: new Walker(this.map, target, this.opts.agentSpeed ?? 3), target, who: o });
        continue;
      }
      have.who = o;
      if (have.target.x !== target.x || have.target.y !== target.y) {
        have.target = target;
        if (this.visible) have.walker.walkTo(target);
        else have.walker.teleport(target);
      }
    }
  }

  others(): (Other & { position: { x: number; y: number } })[] {
    return [...this.others_.values()].map((o) => ({ ...o.who, position: o.walker.position })).sort((a, b) => a.id.localeCompare(b.id));
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
    if (v) {
      for (const w of this.walkers.values()) w.walker.teleport(w.target);
      for (const o of this.others_.values()) o.walker.teleport(o.target);
    }
  }

  tick(dtMs: number): void {
    if (!this.visible) return;
    this.me.tick(dtMs);
    if (this.held && this.me.arrived) this.run(this.held);
    for (const w of this.walkers.values()) w.walker.tick(dtMs);
    for (const o of this.others_.values()) o.walker.tick(dtMs);
    const t = this.me.tile;
    if (t.x !== this.lastTile.x || t.y !== this.lastTile.y) {
      const before = this.presence.roomAt(this.lastTile)?.name ?? null;
      this.presence.move(ME, t);
      const room = this.presence.roomAt(t);
      if ((room?.name ?? null) !== before) for (const fn of this.zoneListeners) fn(room);
      this.lastTile = t;
      for (const fn of this.moveListeners) fn({ x: t.x, y: t.y });
    }
    this.emit(this.proximity.update(this.me.position, this.agents().map((a) => ({ id: a.id, tile: a.position }))));
  }

  private emit(events: ProximityEvent[]): void {
    for (const e of events) for (const fn of this.listeners) fn(e);
  }
}
