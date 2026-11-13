import { describe, expect, it } from 'vitest';
import { OfficePresence, type OfficeMap, type Room } from '../src/office';

const room = (o: Partial<Room> & { name: string; x: number; y: number }): Room => ({ kind: 'department', department: null, w: 3, h: 3, maxUsers: null, locked: false, silent: false, focusable: false, ...o });
/** Three side by side rooms on a 12 x 3 floor: A (open), B (locked, one at a time, silent, focusable) and a meeting room M. */
const map: OfficeMap = {
  width: 12,
  height: 3,
  tile: 32,
  walls: [0, 1, 2].map(() => Array(12).fill(false)),
  rooms: [room({ name: 'A', x: 0, y: 0 }), room({ name: 'B', x: 3, y: 0, locked: true, maxUsers: 1, silent: true, focusable: true }), room({ name: 'M', x: 6, y: 0, kind: 'meeting', maxUsers: 2 })],
  desks: [],
  objects: [],
  entries: [],
};
const A = { x: 1, y: 1 };
const B = { x: 4, y: 1 };
const M = { x: 7, y: 1 };
const out = { x: 10, y: 1 };

describe('entering and leaving rooms (S6-5)', () => {
  it('fires enter once when you walk in and leave once when you walk out, and nothing while you stay', () => {
    const p = new OfficePresence(map);
    expect(p.join('u1', 'owner', out)).toEqual([]);
    expect(p.move('u1', A).events).toEqual([{ kind: 'enter', id: 'u1', room: 'A' }]);
    expect(p.move('u1', { x: 2, y: 1 }).events).toEqual([]);
    expect(p.move('u1', out).events).toEqual([{ kind: 'leave', id: 'u1', room: 'A' }]);
  });

  it('walking straight from one room to the next leaves the first and enters the second', () => {
    const p = new OfficePresence(map);
    p.join('u1', 'owner', A);
    expect(p.move('u1', M).events).toEqual([
      { kind: 'leave', id: 'u1', room: 'A' },
      { kind: 'enter', id: 'u1', room: 'M' },
    ]);
  });

  it('joining inside a room fires enter, and leaving the office fires leave', () => {
    const p = new OfficePresence(map);
    expect(p.join('u1', 'guest', A)).toEqual([{ kind: 'enter', id: 'u1', room: 'A' }]);
    expect(p.leave('u1')).toEqual([{ kind: 'leave', id: 'u1', room: 'A' }]);
    expect(p.snapshot()).toEqual([]);
  });
});

describe('locked rooms and limits (S6-5)', () => {
  it('turns a guest away from a locked room, and the guest stays where they were', () => {
    const p = new OfficePresence(map);
    p.join('g', 'guest', A);
    const r = p.move('g', B);
    expect(r).toEqual({ allowed: false, reason: 'locked', events: [] });
    expect(p.snapshot()[0]!.tile).toEqual(A);
  });

  it('lets the owner into a locked room', () => {
    const p = new OfficePresence(map);
    p.join('o', 'owner', A);
    expect(p.move('o', B).allowed).toBe(true);
    expect(p.snapshot()[0]!.room).toBe('B');
  });

  it('holds the limit: a full room refuses the next person, and has space again when someone leaves', () => {
    const p = new OfficePresence(map);
    for (const id of ['a', 'b', 'c']) p.join(id, 'owner', out);
    expect(p.move('a', M).allowed).toBe(true);
    expect(p.move('b', M).allowed).toBe(true);
    expect(p.move('c', M)).toEqual({ allowed: false, reason: 'full', events: [] });
    p.move('a', out);
    expect(p.move('c', M).allowed).toBe(true);
  });

  it('does not count you against the limit when you move inside the room you are already in', () => {
    const p = new OfficePresence(map);
    p.join('o', 'owner', B);
    expect(p.move('o', { x: 5, y: 2 }).allowed).toBe(true);
  });

  it('refuses to join a locked room as a guest', () => {
    const p = new OfficePresence(map);
    expect(() => p.join('g', 'guest', B)).toThrow(/locked/);
  });
});

describe('what a room says about itself (S6-5)', () => {
  it('knows the room at a tile, and whether its bubbles are silent or its area focusable', () => {
    const p = new OfficePresence(map);
    expect(p.roomAt(A)?.name).toBe('A');
    expect(p.roomAt(out)).toBeNull();
    expect(p.roomAt(B)).toMatchObject({ silent: true, focusable: true });
    expect(p.bubblesAllowed(B)).toBe(false);
    expect(p.bubblesAllowed(A)).toBe(true);
    expect(p.bubblesAllowed(out)).toBe(true);
  });
});

describe('availability and raising a hand (S6-5)', () => {
  it('starts available, and a change shows in the presence record', () => {
    const p = new OfficePresence(map);
    p.join('u', 'owner', A);
    expect(p.snapshot()[0]).toMatchObject({ id: 'u', availability: 'available', handRaised: false, room: 'A' });
    p.setAvailability('u', 'busy');
    expect(p.snapshot()[0]!.availability).toBe('busy');
  });

  it('lets you raise a hand only in a meeting room, and lowers it when you leave', () => {
    const p = new OfficePresence(map);
    p.join('u', 'owner', A);
    expect(p.raiseHand('u', true)).toBe(false); // not in a meeting
    p.move('u', M);
    expect(p.raiseHand('u', true)).toBe(true);
    expect(p.snapshot()[0]!.handRaised).toBe(true);
    p.move('u', out);
    expect(p.snapshot()[0]!.handRaised).toBe(false);
  });

  it('says who is in a room, in a steady order', () => {
    const p = new OfficePresence(map);
    p.join('b', 'owner', M);
    p.join('a', 'owner', M);
    expect(p.occupants('M')).toEqual(['a', 'b']);
  });
});
