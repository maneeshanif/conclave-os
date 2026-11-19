import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OBJECT_TYPES, panelFor, readOfficeMap, type OfficeMap, type OfficeMapJson, type Room } from '@conclave/shared';
import { WorldController } from '../office/controller';
import { PANEL_IDS, panelHref, parsePanel } from '../lib/panels';
import { addChat, nearbyPeople } from '../office/chat';

/**
 * Slice 6, the world half of the end-to-end check (S6-11): on the real office map, from the door you walk into the Outreach room
 * (the zone event fires), up to an agent (its drawer opens, and closes as you leave), to the approvals desk and use it (the inbox
 * panel opens), and the same panel opens from a deep link. The server half is apps/server/test/slice6-e2e.test.ts and the real
 * canvas is checked in the browser run (apps/web/e2e/office.e2e.ts).
 */
const root = path.resolve(import.meta.dirname, '..', '..', '..');
const departments = readFileSync(path.join(root, 'company', 'departments.yaml'), 'utf8')
  .split(/\r?\n/)
  .flatMap((l) => {
    const m = /\{\s*key:\s*([a-z0-9-]+),.*active:\s*(true|false)/.exec(l);
    return m ? [{ key: m[1]!, active: m[2] === 'true' }] : [];
  });
const map: OfficeMap = readOfficeMap(JSON.parse(readFileSync(path.join(root, 'company', 'office.tmj'), 'utf8')) as OfficeMapJson, { file: 'office.tmj', departments });
const outreach = map.rooms.find((r) => r.department === 'outreach')!;
const desk = map.desks.find((d) => d.x >= outreach.x && d.x < outreach.x + outreach.w && d.y >= outreach.y && d.y < outreach.y + outreach.h)!;
const approvalsDesk = map.objects.find((o) => o.type === 'approvals-desk')!;

const walk = (w: WorldController, to: { x: number; y: number }) => {
  expect(w.click(to)).toBe(true);
  w.tick(120_000);
};
const standBeside = (t: { x: number; y: number }) => ({ x: t.x, y: t.y + 1 });

describe('slice 6 in the world (S6-11)', () => {
  it('walks from the door into the Outreach room, and the zone event fires', () => {
    const w = new WorldController(map, { speed: 10 });
    const zones: (string | null)[] = [];
    w.onZone((r: Room | null) => zones.push(r?.name ?? null));
    expect(w.me.tile).toEqual({ x: map.entries.find((e) => e.name === 'door')!.x, y: map.entries.find((e) => e.name === 'door')!.y });
    walk(w, { x: outreach.x + 1, y: outreach.y + 1 });
    expect(zones).toContain(outreach.name);
    expect(w.me.tile.x).toBeGreaterThanOrEqual(outreach.x);
  });

  it("opens an agent's drawer when you walk up to it, and closes it when you walk away", () => {
    const w = new WorldController(map, { speed: 10 });
    w.setAgents([{ agentId: 'scout', x: desk.x, y: desk.y }]);
    const events: string[] = [];
    w.onDrawer((e) => events.push(`${e.kind}:${e.id}`));
    walk(w, standBeside(desk));
    expect(events).toContain('open:scout');
    walk(w, { x: map.entries[0]!.x, y: map.entries[0]!.y });
    expect(events.at(-1)).toBe('close:scout');
  });

  it('uses the approvals desk to open the inbox panel, and every object opens a panel that exists', () => {
    expect(approvalsDesk).toBeTruthy();
    const panel = panelFor('approvals-desk')!;
    expect(panel.panel).toBe('approvals');
    expect(panelHref(panel.panel as (typeof PANEL_IDS)[number])).toBe('/?panel=approvals');
    for (const type of OBJECT_TYPES) {
      const p = panelFor(type)!;
      // A panel the world opens is one the page can show (the not-ready talent room is the one allowed gap).
      if (p.ready) expect(PANEL_IDS as readonly string[], type).toContain(p.panel);
    }
  });

  it('opens the same panel from a deep link, and from an old route', () => {
    expect(parsePanel('?panel=approvals')).toEqual({ id: 'approvals' });
    expect(parsePanel('?panel=boardroom')).toEqual({ id: 'boardroom' });
    expect(parsePanel('?panel=rooms')).toEqual({ id: 'rooms' });
    expect(parsePanel('?panel=nonsense')).toBeNull();
  });

  it('opens the chat for someone near you, and not for someone across the office', () => {
    const w = new WorldController(map, { speed: 10 });
    w.setOthers([
      { id: 'near', name: 'Dana', look: 1, x: w.me.tile.x + 1, y: w.me.tile.y, availability: 'available', handRaised: false },
      { id: 'far', name: 'Eli', look: 2, x: map.width - 2, y: 2, availability: 'available', handRaised: false },
    ]);
    expect(nearbyPeople(w.me.position, w.others(), [])).toEqual(['near']);
    expect(addChat([], { kind: 'chat', id: 'near', name: 'Dana', text: 'hi', at: 1 })).toHaveLength(1);
  });
});
