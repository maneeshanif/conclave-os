import * as Phaser from 'phaser';
import { panelFor } from '@conclave/shared';
import type { OfficeFacts } from '../lib/api';
import { OBJECT_TYPES } from '@conclave/shared';
import { DECOR_NAMES } from './decor';
import { FRAME, availabilityColour, directionOf, frameIndex, lookFor, placeColour, pose, roomTint, type Availability, type Facing } from './art';
import type { WorldController } from './controller';
import { thingAt, type Thing } from './tooltips';

/**
 * The drawing (SPEC 12). A thin Phaser skin over `WorldController`: it loads the Tiled map and our own art, draws the floor, rooms,
 * furniture, objects, the agents and you, and tells the controller about clicks and keys. All the rules live in the controller
 * and in packages/shared; which picture to show is decided in `art.ts`.
 */
export interface WorldHandle {
  destroy(): void;
  resize(): void;
  setVisible(v: boolean): void;
}
export interface Who {
  name: string;
  key: string;
  place: string;
  reason?: string;
  room?: string | null;
}

const TILE = 32;

export function startWorld(opts: {
  parent: HTMLElement;
  mapUrl: string;
  tilesUrl: string;
  peopleUrl: string;
  furnitureUrl: string;
  /** One picture for each object type, in the order of OBJECT_TYPES. */
  objectsUrl?: string;
  /** The folder of scenery pictures (decor/*.png and decor/obj-<type>.png). */
  decorBase?: string;
  /** The sheet of robot agents, laid out like the people sheet. */
  agentsUrl?: string;
  /** What an agent is doing now (working, waiting, blocked, discussion, handoff, idle), for the screen on its desk. */
  stateOf?: (agentId: string) => string | undefined;
  /** The quick reaction over someone's head now (a person's id, or 'me'), or null. */
  emoteOf?: (id: string) => string | null;
  facts: OfficeFacts;
  ctl: WorldController;
  who: () => Map<string, Who>;
  myStatus: () => Availability;
  /** Your look (0 to 5) and name, read each frame so the picker takes effect at once. */
  myLook?: () => number;
  myName?: () => string;
  /** Called with the panel an object opens. */
  onUseObject: (panel: string, ctx?: { dept?: string }) => void;
  /** What is under the pointer, with where it is on the screen (null when nothing, or the pointer left the canvas). */
  onHover?: (t: { thing: Thing; x: number; y: number } | null) => void;
}): WorldHandle {
  const { ctl, facts } = opts;
  ctl.setViewport(opts.parent.clientWidth, opts.parent.clientHeight);

  /** One figure on the floor: a sprite that faces and steps as it moves, with a name and a status dot over it. */
  class Figure {
    private facing: Facing = 'down';
    private travelled = 0;
    private last: { x: number; y: number } | null = null;
    private baseY = -2;
    readonly box: Phaser.GameObjects.Container;
    private readonly sprite: Phaser.GameObjects.Sprite;
    private readonly dot: Phaser.GameObjects.Arc;
    private readonly text: Phaser.GameObjects.Text;

    constructor(
      scene: Phaser.Scene,
      private look: number,
      private readonly sheet: 'people' | 'agents' = 'people',
    ) {
      this.sprite = scene.add.sprite(0, -2, sheet, frameIndex(look, 'down', 0));
      this.dot = scene.add.circle(0, 0, 4, 0x94a3b8).setStrokeStyle(1, 0xffffff);
      this.text = scene.add.text(0, 0, '', { fontSize: '10px', color: '#ffffff', backgroundColor: 'rgba(15,23,42,0.75)', padding: { x: 4, y: 1 } }).setOrigin(0, 0.5);
      this.box = scene.add.container(0, 0, [this.sprite, this.dot, this.text]).setDepth(5);
      this.baseY = -2;
    }

    /** Robots hover: a small bob, all the time. */
    hover(time: number): void {
      if (this.sheet === 'agents') this.sprite.setY(this.baseY + Math.sin(time / 260 + this.box.x) * 1.5);
    }

    setLook(look: number): void {
      if (look === this.look) return;
      this.look = look;
      this.sprite.setFrame(frameIndex(look, this.facing, 0));
    }

    label(name: string, colour: string): void {
      this.text.setText(name);
      const width = this.text.width + 12;
      this.text.setPosition(-width / 2 + 10, -26);
      this.dot.setPosition(-width / 2 + 4, -26).setFillStyle(Phaser.Display.Color.HexStringToColor(colour).color);
    }

    moveTo(x: number, y: number): void {
      if (this.last) {
        const dx = x - this.last.x;
        const dy = y - this.last.y;
        this.facing = directionOf(dx, dy, this.facing);
        this.travelled += Math.hypot(dx, dy);
        this.sprite.setFrame(frameIndex(this.look, this.facing, pose(dx !== 0 || dy !== 0, this.travelled)));
      }
      this.last = { x, y };
      this.box.setPosition(x * TILE + TILE / 2, y * TILE + TILE / 2);
      // Drawn by where its feet are, so a figure goes behind a desk or a sofa above it and in front of one below it.
      this.box.setDepth(y * TILE + TILE / 2 + 1);
    }
  }

  class OfficeScene extends Phaser.Scene {
    private figures = new Map<string, Figure>();
    private me?: Figure;
    private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
    private heldDir: Facing | null = null;
    private screens: { rect: Phaser.GameObjects.Rectangle; agentId: string | null }[] = [];

    constructor() {
      super('office');
    }

    preload() {
      this.load.tilemapTiledJSON('office', opts.mapUrl);
      this.load.image('tiles', opts.tilesUrl);
      this.load.spritesheet('people', opts.peopleUrl, { frameWidth: FRAME, frameHeight: FRAME });
      this.load.spritesheet('furniture', opts.furnitureUrl, { frameWidth: FRAME, frameHeight: FRAME });
      if (opts.objectsUrl) this.load.spritesheet('objects', opts.objectsUrl, { frameWidth: FRAME, frameHeight: FRAME });
      if (opts.agentsUrl) this.load.spritesheet('agents', opts.agentsUrl, { frameWidth: FRAME, frameHeight: FRAME });
      if (opts.decorBase) {
        for (const n of DECOR_NAMES) this.load.image(`decor-${n}`, `${opts.decorBase}/${n}.png`);
        for (const t of OBJECT_TYPES) this.load.image(`obj-${t}`, `${opts.decorBase}/obj-${t}.png`);
      }
    }

    create() {
      const map = this.make.tilemap({ key: 'office' });
      const tiles = map.addTilesetImage('office', 'tiles');
      if (tiles) {
        map.createLayer('floor', tiles);
      }
      // A piece of scenery drawn by where its bottom edge is, so you can walk behind it.
      const put = (key: string, cx: number, cy: number, bottom: number) => this.add.image(cx, cy, key).setDepth(bottom);
      for (const r of facts.map.rooms) {
        const tint = roomTint(r);
        if (tint) this.add.rectangle(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE, tint.colour, tint.alpha).setOrigin(0, 0).setDepth(1);
        this.add.text((r.x + r.w / 2) * TILE, (r.y + r.h / 2) * TILE, r.name.toUpperCase(), { fontSize: '20px', color: '#1e293b', fontStyle: 'bold' }).setOrigin(0.5).setAlpha(0.18).setDepth(2);
      }
      // Scenery from the map's decor layer: rugs under everything, the rest sorted by their bottom edge.
      for (const d of map.getObjectLayer('decor')?.objects ?? []) {
        const key = `decor-${d.name}`;
        if (!this.textures.exists(key) || d.x === undefined || d.y === undefined) continue;
        const w = d.width ?? TILE;
        const h = d.height ?? TILE;
        const img = put(key, d.x + w / 2, d.y + h / 2, d.name === 'rug' ? 1.5 : d.y + h);
        const turn = (d.properties as { name: string; value: number }[] | undefined)?.find((p) => p.name === 'turn')?.value;
        if (turn) img.setAngle(turn);
      }
      // Each agent's desk and chair, from the data (so a room added later has them too). The agent stands on the chair tile.
      const screens: { rect: Phaser.GameObjects.Rectangle; agentId: string | null }[] = [];
      for (const d of facts.map.desks) {
        const owner = facts.agents.find((a) => a.room === d.room && a.desk === d.slot) ?? null;
        if (this.textures.exists('decor-desk')) {
          const desk = put('decor-desk', d.x * TILE + TILE / 2, (d.y - 1) * TILE + TILE / 2 + 2, d.y * TILE - 1);
          // The screen on the desk: lit by what its agent is doing.
          const sw = Math.max(6, Math.round(desk.width * 0.34));
          const rect = this.add.rectangle(desk.x, desk.y - desk.height * 0.3, sw, Math.max(2, Math.round(desk.height * 0.13)), 0x1e293b).setDepth(d.y * TILE - 0.5);
          screens.push({ rect, agentId: owner?.id ?? null });
        } else {
          this.add.sprite(d.x * TILE + TILE / 2, (d.y - 1) * TILE + TILE / 2, 'furniture', 0).setDepth(d.y * TILE - 1);
        }
        // An empty desk has a sleeping robot on it, faded, so the seats read as seats waiting for an agent.
        if (!owner && this.textures.exists('agents')) this.add.sprite(d.x * TILE + TILE / 2, d.y * TILE + TILE / 2 - 2, 'agents', frameIndex(0, 'down', 0)).setAlpha(0.28).setDepth((d.y + 1) * TILE - 4);
        if (this.textures.exists('decor-chair')) put('decor-chair', d.x * TILE + TILE / 2, d.y * TILE + TILE / 2 + 4, (d.y + 1) * TILE - 2).setAngle(180).setScale(0.8);
      }
      this.screens = screens;
      // The things you use. Each has its own picture at its own size; a click on it opens its panel.
      for (const o of facts.map.objects) {
        const panel = panelFor(o.type);
        if (!panel) continue;
        const key = `obj-${o.type}`;
        const frame = OBJECT_TYPES.indexOf(o.type as (typeof OBJECT_TYPES)[number]);
        let box: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle;
        if (this.textures.exists(key)) {
          const tex = this.textures.get(key).getSourceImage();
          const w = Math.ceil(tex.width / TILE) * TILE;
          const h = Math.ceil(tex.height / TILE) * TILE;
          box = put(key, o.x * TILE + w / 2, o.y * TILE + h / 2, o.y * TILE + h).setAlpha(panel.ready ? 1 : 0.55);
        } else if (opts.objectsUrl && frame >= 0) {
          box = this.add.sprite(o.x * TILE + TILE / 2, o.y * TILE + TILE / 2, 'objects', frame).setDepth(o.y * TILE + TILE).setAlpha(panel.ready ? 1 : 0.5);
        } else {
          box = this.add.rectangle(o.x * TILE + TILE / 2, o.y * TILE + TILE / 2, TILE - 6, TILE - 6, panel.ready ? 0x0f766e : 0x94a3b8).setDepth(o.y * TILE + TILE);
        }
        box.setInteractive({ useHandCursor: panel.ready });
        box.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, e: Phaser.Types.Input.EventData) => {
          e.stopPropagation();
          if (panel.ready && this.input.activePointer.downElement === this.game.canvas) {
            // A department board or table opens for the department whose room it is in.
            const room = facts.map.rooms.find((r) => o.x >= r.x && o.x < r.x + r.w && o.y >= r.y && o.y < r.y + r.h);
            opts.onUseObject(panel.panel, room?.department ? { dept: room.department } : undefined);
          }
        });
      }
      this.me = new Figure(this, opts.myLook?.() ?? lookFor(null));
      this.cameras.main.setBounds(0, 0, facts.map.width * TILE, facts.map.height * TILE);
      this.cameras.main.startFollow(this.me.box, true, 0.15, 0.15);
      this.cursors = this.input.keyboard?.createCursorKeys();
      // A press that began on something over the canvas (the bar, a dialog) is not a click on the world.
      // What is under the pointer, for the tooltip. Only while the pointer is over the canvas itself.
      this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
        const thing = thingAt(facts, ctl.agents(), ctl.me.position, p.worldX, p.worldY);
        opts.onHover?.(thing ? { thing, x: p.x, y: p.y } : null);
      });
      this.input.on('gameout', () => opts.onHover?.(null));
      this.input.on('pointerdown', (p: Phaser.Input.Pointer) => p.downElement === this.game.canvas && ctl.click({ x: Math.floor(p.worldX / TILE), y: Math.floor(p.worldY / TILE) }));
    }

    /** The monitor on each desk shows what its agent is doing: green lines scroll while it works, amber blinks when it waits, red when blocked. */
    private drawScreens(time: number): void {
      for (const sc of this.screens) {
        const state = sc.agentId ? opts.stateOf?.(sc.agentId) : undefined;
        const tick = Math.floor(time / 180);
        let colour = 0x1e293b; // off
        if (state === 'working') colour = [0x22c55e, 0x16a34a, 0x4ade80, 0x15803d][tick % 4]!;
        else if (state === 'waiting') colour = tick % 4 < 2 ? 0xf59e0b : 0x78350f;
        else if (state === 'blocked') colour = tick % 4 < 2 ? 0xef4444 : 0x7f1d1d;
        else if (state === 'discussion' || state === 'handoff') colour = 0x38bdf8;
        else if (state === 'idle') colour = 0x334155;
        sc.rect.setFillStyle(colour);
      }
    }

    update(_time: number, delta: number) {
      ctl.tick(delta);
      const k = this.cursors;
      if (k) {
        const dir: Facing | null = k.up.isDown ? 'up' : k.down.isDown ? 'down' : k.left.isDown ? 'left' : k.right.isDown ? 'right' : null;
        if (dir !== this.heldDir) {
          this.heldDir = dir;
          ctl.hold(dir);
        }
      }
      this.cameras.main.setZoom(ctl.zoom);
      const p = ctl.me.position;
      const status = opts.myStatus();
      this.me?.moveTo(p.x, p.y);
      for (const f of this.figures.values()) f.hover(_time);
      this.drawScreens(_time);
      this.me?.setLook(opts.myLook?.() ?? 0);
      this.me?.label(`${opts.emoteOf?.('me') ? `${opts.emoteOf('me')} ` : ''}${opts.myName?.() ?? 'You'}`, availabilityColour(status));
      const who = opts.who();
      const live = new Set<string>();
      for (const a of ctl.agents()) {
        live.add(a.id);
        const info = who.get(a.id);
        let f = this.figures.get(a.id);
        if (!f) {
          f = this.textures.exists('agents') ? new Figure(this, lookFor(info?.key ?? a.id) - 1, 'agents') : new Figure(this, lookFor(info?.key ?? a.id));
          this.figures.set(a.id, f);
        }
        f.moveTo(a.position.x, a.position.y);
        f.label(info?.name ?? '?', placeColour(info?.place ?? 'lounge'));
      }
      for (const o of ctl.others()) {
        const id = `person:${o.id}`;
        live.add(id);
        let f = this.figures.get(id);
        if (!f) {
          f = new Figure(this, o.look);
          this.figures.set(id, f);
        }
        f.setLook(o.look);
        f.moveTo(o.position.x, o.position.y);
        const moji = opts.emoteOf?.(o.id);
        f.label(`${moji ? `${moji} ` : ''}${o.handRaised ? `${o.name} ✋` : o.name}`, availabilityColour(o.availability));
      }
      for (const [id, f] of this.figures) {
        if (!live.has(id)) {
          f.box.destroy();
          this.figures.delete(id);
        }
      }
    }
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: opts.parent,
    backgroundColor: '#1b2340',
    // Crisp pixels at any zoom: no smoothing between them.
    pixelArt: true,
    roundPixels: true,
    scale: { mode: Phaser.Scale.RESIZE },
    // Only presses on the canvas itself count; the bar and the dialogs over it are not the world.
    input: { windowEvents: false },
    scene: OfficeScene,
  });

  return {
    destroy: () => game.destroy(true),
    resize: () => ctl.setViewport(opts.parent.clientWidth, opts.parent.clientHeight),
    setVisible: (v) => {
      ctl.setVisible(v);
      if (v) game.loop.wake();
      else game.loop.sleep();
    },
  };
}
