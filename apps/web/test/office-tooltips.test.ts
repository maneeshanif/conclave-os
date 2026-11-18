import { describe, expect, it } from 'vitest';
import type { OfficeFacts } from '../lib/api';
import { describeThing, placeTooltip, thingAt, type Known } from '../office/tooltips';

const room = (name: string, x: number, y: number, over: Record<string, unknown> = {}) => ({ name, kind: 'department' as const, department: name.toLowerCase(), x, y, w: 5, h: 5, maxUsers: null, locked: false, silent: false, focusable: false, ...over });
const facts: OfficeFacts = {
  map: {
    width: 40,
    height: 24,
    tile: 32,
    rooms: [room('Outreach', 0, 0), room('Vault', 6, 0, { locked: true, kind: 'meeting', department: null }), room('Lounge', 12, 0, { kind: 'lounge', department: null, silent: true, maxUsers: 6 })],
    desks: [],
    objects: [
      { type: 'approvals-desk', name: 'Approvals', x: 1, y: 1 },
      { type: 'jobboard', name: 'Jobs', x: 3, y: 1 },
      { type: 'dept-board', name: 'Outreach board', x: 2, y: 3 },
    ],
    entries: [],
    walls: [],
  },
  agents: [],
};
const who = new Map([
  ['a1', { name: 'Scout', key: 'scout', place: 'desk', reason: 'Working on a task.', room: 'Outreach' }],
  ['a2', { name: 'Closer', key: 'closer', place: 'approvals', reason: 'Waiting for you to decide.', room: 'Outreach' }],
]);
const known: Known = { facts, who, hereIn: (r) => (r === 'Outreach' ? ['Scout', 'Closer'] : []), myStatus: 'busy' };
const px = (tile: number) => tile * 32;

describe('what a tooltip says (S6-14b1)', () => {
  it('names an agent, where it works, where it is and why', () => {
    expect(describeThing({ kind: 'agent', id: 'a2' }, known)).toEqual({ title: 'Closer', line: 'Outreach. At the approvals desk. Waiting for you to decide.' });
  });

  it('says what an object opens (every object has a page now, so none says "coming soon")', () => {
    expect(describeThing({ kind: 'object', id: 'Approvals' }, known)).toEqual({ title: 'Approvals inbox', line: 'Click to open.' });
    expect(describeThing({ kind: 'object', id: 'Jobs' }, known)).toEqual({ title: 'Talent room', line: 'Click to open.' });
  });

  it('names the room a board belongs to', () => {
    expect(describeThing({ kind: 'object', id: 'Outreach board' }, known)).toEqual({ title: 'Outreach board', line: 'Click to open the Outreach board.' });
  });

  it('says who is in a room and what its rules are', () => {
    expect(describeThing({ kind: 'room', id: 'Outreach' }, known)).toEqual({ title: 'Outreach', line: 'Scout and Closer are here.' });
    const vault = describeThing({ kind: 'room', id: 'Vault' }, known)!;
    expect(vault.title).toBe('Vault');
    expect(vault.line).toMatch(/Nobody is here/);
    expect(vault.line).toMatch(/locked/i);
    const lounge = describeThing({ kind: 'room', id: 'Lounge' }, known)!.line;
    expect(lounge).toMatch(/quiet/i);
    expect(lounge).toMatch(/up to 6/);
  });

  it('says it is you, with your status', () => {
    expect(describeThing({ kind: 'you', id: 'me' }, known)).toEqual({ title: 'You', line: 'Busy.' });
  });

  it('copes with something that is not there any more', () => {
    expect(describeThing({ kind: 'agent', id: 'gone' }, known)).toBeNull();
    expect(describeThing({ kind: 'room', id: 'Nowhere' }, known)).toBeNull();
  });
});

describe('what is under the pointer (S6-14b1)', () => {
  const agents = [{ id: 'a1', position: { x: 2, y: 2 } }];
  const me = { x: 10, y: 3 };

  it('finds an agent near the pointer, and you, before anything on the floor', () => {
    expect(thingAt(facts, agents, me, px(2) + 16, px(2) + 16)).toEqual({ kind: 'agent', id: 'a1' });
    expect(thingAt(facts, agents, me, px(10) + 16, px(3) + 16)).toEqual({ kind: 'you', id: 'me' });
  });

  it('finds an object by its tile, then the room, and nothing in open space', () => {
    expect(thingAt(facts, [], me, px(1) + 5, px(1) + 5)).toEqual({ kind: 'object', id: 'Approvals' });
    expect(thingAt(facts, [], me, px(4), px(4))).toEqual({ kind: 'room', id: 'Outreach' });
    expect(thingAt(facts, [], me, px(30), px(20))).toBeNull();
    expect(thingAt(facts, [], me, -10, -10)).toBeNull();
  });

  it('picks the nearest of two agents close together, and ignores one that is too far', () => {
    const two = [{ id: 'far', position: { x: 2, y: 2 } }, { id: 'near', position: { x: 2.4, y: 2 } }];
    expect(thingAt(facts, two, me, px(2) + 16 + 14, px(2) + 16)).toEqual({ kind: 'agent', id: 'near' });
    expect(thingAt(facts, [{ id: 'a1', position: { x: 2, y: 2 } }], me, px(2) + 16 + 40, px(2) + 16)?.kind).not.toBe('agent');
  });
});

describe('where the tooltip goes (S6-14b1)', () => {
  it('sits beside the pointer, and stays inside the box when the pointer is near an edge', () => {
    expect(placeTooltip(100, 100, 120, 40, 800, 600)).toEqual({ left: 112, top: 112 });
    expect(placeTooltip(790, 100, 120, 40, 800, 600).left).toBeLessThanOrEqual(800 - 120);
    expect(placeTooltip(100, 590, 120, 40, 800, 600).top).toBeLessThanOrEqual(600 - 40);
    expect(placeTooltip(0, 0, 120, 40, 800, 600).left).toBeGreaterThanOrEqual(0);
  });
});
