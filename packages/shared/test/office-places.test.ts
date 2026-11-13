import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { placeAgents, readOfficeMap, type AgentFacts, type OfficeMap, type OfficeMapJson } from '../src/office';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const departments = readFileSync(path.join(root, 'company', 'departments.yaml'), 'utf8')
  .split(/\r?\n/)
  .flatMap((l) => {
    const m = /\{\s*key:\s*([a-z0-9-]+),.*active:\s*(true|false)/.exec(l);
    return m ? [{ key: m[1]!, active: m[2] === 'true' }] : [];
  });
const map: OfficeMap = readOfficeMap(JSON.parse(readFileSync(path.join(root, 'company', 'office.tmj'), 'utf8')) as OfficeMapJson, { file: 'office.tmj', departments });
const agent = (id: string, over: Partial<AgentFacts> = {}): AgentFacts => ({ agentId: id, room: 'Outreach', desk: 1, running: false, waitingForYou: false, inDiscussion: false, ...over });
const one = (a: AgentFacts) => placeAgents(map, [a])[0]!;
const inRoom = (name: string, p: { x: number; y: number }) => {
  const r = map.rooms.find((x) => x.name === name)!;
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
};
const near = (a: { x: number; y: number }, b: { x: number; y: number }, d: number) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= d;

describe('where an agent stands (S6-3)', () => {
  it('is at its desk while a run is going', () => {
    const p = one(agent('a', { running: true, room: 'Outreach', desk: 2 }));
    const desk = map.desks.find((d) => d.room === 'Outreach' && d.slot === 2)!;
    expect(p).toMatchObject({ place: 'desk', x: desk.x, y: desk.y });
  });

  it('is at the approvals desk while something it proposed waits for a person', () => {
    const p = one(agent('a', { waitingForYou: true }));
    const desk = map.objects.find((o) => o.type === 'approvals-desk')!;
    expect(p.place).toBe('approvals');
    expect(near(p, desk, 2)).toBe(true);
  });

  it('is in the Boardroom during a discussion, near the table', () => {
    const p = one(agent('a', { inDiscussion: true }));
    expect(p.place).toBe('boardroom');
    expect(inRoom('Boardroom', p)).toBe(true);
    expect(near(p, map.objects.find((o) => o.type === 'boardroom-table')!, 4)).toBe(true);
  });

  it('is in the lounge when it has nothing to do', () => {
    const p = one(agent('a'));
    expect(p.place).toBe('lounge');
    expect(inRoom('Lounge', p)).toBe(true);
  });

  it('works in the lounge when it has no desk, because there is nowhere else', () => {
    const p = one(agent('a', { running: true, room: 'Lounge', desk: null }));
    expect(p.place).toBe('desk');
    expect(inRoom('Lounge', p)).toBe(true);
  });

  it('goes to the stronger reason by a fixed order: working, then waiting for you, then a discussion, then idle', () => {
    expect(one(agent('a', { running: true, waitingForYou: true, inDiscussion: true })).place).toBe('desk');
    expect(one(agent('a', { waitingForYou: true, inDiscussion: true })).place).toBe('approvals');
    expect(one(agent('a', { inDiscussion: true })).place).toBe('boardroom');
    expect(one(agent('a')).place).toBe('lounge');
  });

  it('says why, in a line a person can read', () => {
    expect(one(agent('a', { running: true })).reason).toMatch(/working/i);
    expect(one(agent('a', { waitingForYou: true })).reason).toMatch(/waiting for you/i);
    expect(one(agent('a', { inDiscussion: true })).reason).toMatch(/discussion/i);
    expect(one(agent('a')).reason).toMatch(/idle/i);
  });

  it('puts agents sharing a place on different tiles, on open floor, the same way every time', () => {
    const many = Array.from({ length: 6 }, (_, i) => agent(`a${i}`));
    const first = placeAgents(map, many);
    expect(placeAgents(map, many)).toEqual(first);
    const tiles = first.map((p) => `${p.x},${p.y}`);
    expect(new Set(tiles).size).toBe(6);
    for (const p of first) expect(map.walls[p.y]![p.x]).toBe(false);
    const waiting = placeAgents(map, many.map((a) => ({ ...a, waitingForYou: true })));
    expect(new Set(waiting.map((p) => `${p.x},${p.y}`)).size).toBe(6);
  });

  it('does not depend on the order the agents are given in', () => {
    const many = Array.from({ length: 4 }, (_, i) => agent(`a${i}`));
    const forward = Object.fromEntries(placeAgents(map, many).map((p) => [p.agentId, `${p.x},${p.y}`]));
    const backward = Object.fromEntries(placeAgents(map, [...many].reverse()).map((p) => [p.agentId, `${p.x},${p.y}`]));
    expect(backward).toEqual(forward);
  });

  it('stacks rather than fails when more agents share a place than it has tiles', () => {
    const crowd = Array.from({ length: 80 }, (_, i) => agent(`c${i}`, { inDiscussion: true }));
    const placed = placeAgents(map, crowd);
    expect(placed).toHaveLength(80);
    for (const p of placed) expect(inRoom('Boardroom', p)).toBe(true);
  });
});
