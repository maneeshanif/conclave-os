import { panelFor, zoneNotice } from '@conclave/shared';
import type { OfficeFacts } from '../lib/api';

/**
 * What a tooltip over the world says, and what is under the pointer (S6-14b1). Pure: the same facts the list uses, so the world and
 * the list always say the same thing, and tested with no canvas.
 */
export const WHERE: Record<string, string> = { desk: 'At its desk', approvals: 'At the approvals desk', boardroom: 'In the Boardroom', lounge: 'In the lounge', handoff: 'Handing over a task' };

export interface Thing {
  kind: 'agent' | 'you' | 'object' | 'room';
  id: string;
}
export interface Known {
  facts: OfficeFacts;
  who: Map<string, { name: string; key: string; place: string; reason?: string; room?: string | null }>;
  /** Names of the agents standing in a room, for the room's tooltip. */
  hereIn: (room: string) => string[];
  myStatus: 'available' | 'busy' | 'away';
}

const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

export function describeThing(t: Thing, k: Known): { title: string; line: string } | null {
  if (t.kind === 'you') return { title: 'You', line: `${k.myStatus[0]!.toUpperCase()}${k.myStatus.slice(1)}.` };
  if (t.kind === 'agent') {
    const w = k.who.get(t.id);
    if (!w) return null;
    return { title: w.name, line: [w.room ? `${w.room}.` : '', `${WHERE[w.place] ?? ''}.`, w.reason ?? ''].filter(Boolean).join(' ') };
  }
  if (t.kind === 'object') {
    const o = k.facts.map.objects.find((x) => x.name === t.id);
    const panel = o ? panelFor(o.type) : null;
    if (!o || !panel) return null;
    if (o.type === 'dept-board' || o.type === 'dept-table') return { title: o.name, line: `Click to open the ${o.name}.` };
    return { title: panel.label, line: panel.ready ? 'Click to open.' : 'Coming soon.' };
  }
  const r = k.facts.map.rooms.find((x) => x.name === t.id);
  if (!r) return null;
  const here = k.hereIn(r.name);
  const who = here.length ? `${list(here)} ${here.length === 1 ? 'is' : 'are'} here.` : 'Nobody is here.';
  return { title: r.name, line: [who, zoneNotice(r)].filter(Boolean).join(' ') };
}

/** What is at a point in the world (in pixels): an agent or you if one is near, then an object on that tile, then the room. */
export function thingAt(facts: OfficeFacts, agents: { id: string; position: { x: number; y: number } }[], me: { x: number; y: number }, wx: number, wy: number): Thing | null {
  const T = facts.map.tile;
  const px = wx / T;
  const py = wy / T;
  let best: { thing: Thing; d: number } | null = null;
  const consider = (thing: Thing, p: { x: number; y: number }) => {
    const d = Math.hypot(px - (p.x + 0.5), py - (p.y + 0.5));
    if (d <= 0.6 && (!best || d < best.d)) best = { thing, d };
  };
  consider({ kind: 'you', id: 'me' }, me);
  for (const a of agents) consider({ kind: 'agent', id: a.id }, a.position);
  if (best) return (best as { thing: Thing }).thing;
  const tx = Math.floor(px);
  const ty = Math.floor(py);
  const o = facts.map.objects.find((x) => x.x === tx && x.y === ty);
  if (o) return { kind: 'object', id: o.name };
  const r = facts.map.rooms.find((x) => tx >= x.x && tx < x.x + x.w && ty >= x.y && ty < x.y + x.h);
  return r ? { kind: 'room', id: r.name } : null;
}

/** Beside the pointer, kept inside the box. */
export function placeTooltip(x: number, y: number, w: number, h: number, boxW: number, boxH: number): { left: number; top: number } {
  return { left: Math.max(0, Math.min(x + 12, boxW - w)), top: Math.max(0, Math.min(y + 12, boxH - h)) };
}
