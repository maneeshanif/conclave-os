import * as Phaser from 'phaser';
import { panelFor } from '@conclave/shared';
import type { OfficeFacts } from '../lib/api';
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
    readonly box: Phaser.GameObjects.Container;
    private readonly sprite: Phaser.GameObjects.Sprite;
    private readonly dot: Phaser.GameObjects.Arc;
    private readonly text: Phaser.GameObjects.Text;

    constructor(
      scene: Phaser.Scene,
      private look: number,
    ) {
      this.sprite = scene.add.sprite(0, -2, 'people', frameIndex(look, 'down', 0));
      this.dot = scene.add.circle(0, 0, 4, 0x94a3b8).setStrokeStyle(1, 0xffffff);
      this.text = scene.add.text(0, 0, '', { fontSize: '10px', color: '#ffffff', backgroundColor: 'rgba(15,23,42,0.75)', padding: { x: 4, y: 1 } }).setOrigin(0, 0.5);
      this.box = scene.add.container(0, 0, [this.sprite, this.dot, this.text]).setDepth(5);
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
    }
  }

  class OfficeScene extends Phaser.Scene {
    private figures = new Map<string, Figure>();
    private me?: Figure;
    private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
    private heldDir: Facing | null = null;

    constructor() {
      super('office');
    }

    preload() {
      this.load.tilemapTiledJSON('office', opts.mapUrl);
      this.load.image('tiles', opts.tilesUrl);
      this.load.spritesheet('people', opts.peopleUrl, { frameWidth: FRAME, frameHeight: FRAME });
      this.load.spritesheet('furniture', opts.furnitureUrl, { frameWidth: FRAME, frameHeight: FRAME });
    }

    create() {
      const map = this.make.tilemap({ key: 'office' });
      const tiles = map.addTilesetImage('office', 'tiles');
      if (tiles) {
        map.createLayer('floor', tiles);
        map.createLayer('collision', tiles);
      }
      const open = (x: number, y: number) => x >= 0 && y >= 0 && x < facts.map.width && y < facts.map.height && facts.map.walls[y]![x] === '.';
      const taken = new Set<string>([...facts.map.desks, ...facts.map.objects, ...facts.map.entries].map((t) => `${t.x},${t.y}`));

      for (const r of facts.map.rooms) {
        const tint = roomTint(r);
        if (tint) this.add.rectangle(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE, tint.colour, tint.alpha).setOrigin(0, 0).setDepth(1);
        this.add.text((r.x + r.w / 2) * TILE, (r.y + r.h / 2) * TILE, r.name.toUpperCase(), { fontSize: '20px', color: '#1e293b', fontStyle: 'bold' }).setOrigin(0.5).setAlpha(0.22).setDepth(2);
        // A plant in the top right corner of a room, where nothing else is.
        const corner = { x: r.x + r.w - 1, y: r.y };
        if (r.kind !== 'hall' && open(corner.x, corner.y) && !taken.has(`${corner.x},${corner.y}`)) this.add.sprite(corner.x * TILE + TILE / 2, corner.y * TILE + TILE / 2, 'furniture', 2).setDepth(3);
      }
      for (const d of facts.map.desks) {
        if (open(d.x, d.y - 1) && !taken.has(`${d.x},${d.y - 1}`)) this.add.sprite(d.x * TILE + TILE / 2, (d.y - 1) * TILE + TILE / 2, 'furniture', 0).setDepth(3);
        this.add.sprite(d.x * TILE + TILE / 2, d.y * TILE + TILE / 2, 'furniture', 1).setDepth(3);
      }
      for (const o of facts.map.objects) {
        const panel = panelFor(o.type);
        if (!panel) continue;
        const box = this.add.rectangle(o.x * TILE + TILE / 2, o.y * TILE + TILE / 2, TILE - 6, TILE - 6, panel.ready ? 0x0f766e : 0x94a3b8).setDepth(3).setInteractive({ useHandCursor: panel.ready });
        this.add.text(o.x * TILE + TILE / 2, o.y * TILE - 2, panel.label, { fontSize: '9px', color: '#0f172a' }).setOrigin(0.5, 1).setDepth(3);
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
      this.me.box.setDepth(6);
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
      this.me?.setLook(opts.myLook?.() ?? 0);
      this.me?.label(opts.myName?.() ?? 'You', availabilityColour(status));
      const who = opts.who();
      const live = new Set<string>();
      for (const a of ctl.agents()) {
        live.add(a.id);
        const info = who.get(a.id);
        let f = this.figures.get(a.id);
        if (!f) {
          f = new Figure(this, lookFor(info?.key ?? a.id));
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
        f.label(o.handRaised ? `${o.name} ✋` : o.name, availabilityColour(o.availability));
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
    backgroundColor: '#f8fafc',
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
