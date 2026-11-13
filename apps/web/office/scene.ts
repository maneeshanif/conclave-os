import * as Phaser from 'phaser';
import { panelFor } from '@conclave/shared';
import type { OfficeFacts } from '../lib/api';
import type { WorldController } from './controller';

/**
 * The drawing (SPEC 12). A thin Phaser skin over `WorldController`: it loads the Tiled map, draws the floor, rooms, objects, the
 * agents and you, and tells the controller about clicks and keys. All the rules live in the controller and in packages/shared.
 */
export interface WorldHandle {
  destroy(): void;
  resize(): void;
  setVisible(v: boolean): void;
}

const TILE = 32;

export function startWorld(opts: { parent: HTMLElement; mapUrl: string; tilesUrl: string; facts: OfficeFacts; ctl: WorldController; names: () => Map<string, string>; onUseObject: (href: string) => void }): WorldHandle {
  const { ctl, facts } = opts;
  ctl.setViewport(opts.parent.clientWidth, opts.parent.clientHeight);

  class OfficeScene extends Phaser.Scene {
    private dots = new Map<string, Phaser.GameObjects.Container>();
    private me?: Phaser.GameObjects.Arc;
    private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
    private heldDir: 'up' | 'down' | 'left' | 'right' | null = null;

    constructor() {
      super('office');
    }

    preload() {
      this.load.tilemapTiledJSON('office', opts.mapUrl);
      this.load.image('tiles', opts.tilesUrl);
    }

    create() {
      const map = this.make.tilemap({ key: 'office' });
      const tiles = map.addTilesetImage('office', 'tiles');
      if (tiles) {
        map.createLayer('floor', tiles);
        map.createLayer('collision', tiles);
      }
      for (const r of facts.map.rooms) this.add.text(r.x * TILE + 4, r.y * TILE + 2, r.name, { fontSize: '11px', color: '#475569' }).setDepth(2);
      for (const o of facts.map.objects) {
        const panel = panelFor(o.type);
        if (!panel) continue;
        const box = this.add.rectangle(o.x * TILE + TILE / 2, o.y * TILE + TILE / 2, TILE - 6, TILE - 6, panel.ready ? 0x0f766e : 0x94a3b8).setDepth(3).setInteractive({ useHandCursor: panel.ready });
        this.add.text(o.x * TILE + TILE / 2, o.y * TILE - 2, panel.label, { fontSize: '9px', color: '#0f172a' }).setOrigin(0.5, 1).setDepth(3);
        box.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, e: Phaser.Types.Input.EventData) => {
          e.stopPropagation();
          if (panel.ready) opts.onUseObject(panel.href);
        });
      }
      this.me = this.add.circle(0, 0, 10, 0xdc2626).setDepth(6);
      this.cameras.main.setBounds(0, 0, facts.map.width * TILE, facts.map.height * TILE);
      this.cameras.main.startFollow(this.me, true, 0.15, 0.15);
      this.cursors = this.input.keyboard?.createCursorKeys();
      this.input.on('pointerdown', (p: Phaser.Input.Pointer) => ctl.click({ x: Math.floor(p.worldX / TILE), y: Math.floor(p.worldY / TILE) }));
    }

    update(_time: number, delta: number) {
      ctl.tick(delta);
      const k = this.cursors;
      if (k) {
        const dir = k.up.isDown ? 'up' : k.down.isDown ? 'down' : k.left.isDown ? 'left' : k.right.isDown ? 'right' : null;
        if (dir !== this.heldDir) {
          this.heldDir = dir;
          ctl.hold(dir);
        }
      }
      this.cameras.main.setZoom(ctl.zoom);
      const p = ctl.me.position;
      this.me?.setPosition(p.x * TILE + TILE / 2, p.y * TILE + TILE / 2);
      const names = opts.names();
      const live = new Set<string>();
      for (const a of ctl.agents()) {
        live.add(a.id);
        let c = this.dots.get(a.id);
        if (!c) {
          const label = (names.get(a.id) ?? '?').slice(0, 2).toUpperCase();
          c = this.add.container(0, 0, [this.add.circle(0, 0, 11, 0x2563eb).setStrokeStyle(2, 0xffffff), this.add.text(0, 0, label, { fontSize: '10px', color: '#ffffff' }).setOrigin(0.5)]).setDepth(5);
          this.dots.set(a.id, c);
        }
        c.setPosition(a.position.x * TILE + TILE / 2, a.position.y * TILE + TILE / 2);
      }
      for (const [id, c] of this.dots) {
        if (!live.has(id)) {
          c.destroy();
          this.dots.delete(id);
        }
      }
    }
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: opts.parent,
    backgroundColor: '#f8fafc',
    scale: { mode: Phaser.Scale.RESIZE },
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
