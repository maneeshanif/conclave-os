import { describe, expect, it } from 'vitest';
import { Proximity } from '../src/office';

const at = (x: number, y = 0) => ({ x, y });

describe('walking up to an agent (S6-6)', () => {
  it('opens the drawer once when you come within range, and closes it once when you step back out', () => {
    const p = new Proximity(2, 3);
    expect(p.update(at(10), [{ id: 'a', tile: at(0) }])).toEqual([]);
    expect(p.update(at(2), [{ id: 'a', tile: at(0) }])).toEqual([{ kind: 'open', id: 'a' }]);
    expect(p.update(at(1), [{ id: 'a', tile: at(0) }])).toEqual([]); // still near: nothing again
    expect(p.update(at(5), [{ id: 'a', tile: at(0) }])).toEqual([{ kind: 'close', id: 'a' }]);
    expect(p.current).toBeNull();
  });

  it('does not flicker on the edge: it opens at 2 tiles but stays open until you are past 3', () => {
    const p = new Proximity(2, 3);
    p.update(at(2), [{ id: 'a', tile: at(0) }]);
    expect(p.update(at(3), [{ id: 'a', tile: at(0) }])).toEqual([]); // between the two: stays open
    expect(p.current).toBe('a');
    expect(p.update(at(4), [{ id: 'a', tile: at(0) }])).toEqual([{ kind: 'close', id: 'a' }]);
    expect(p.update(at(3), [{ id: 'a', tile: at(0) }])).toEqual([]); // and does not reopen until 2 again
  });

  it('with two agents near, opens the nearest, and ties go to the lower id', () => {
    const p = new Proximity(3, 4);
    expect(p.update(at(2), [{ id: 'b', tile: at(0) }, { id: 'a', tile: at(4) }])).toEqual([{ kind: 'open', id: 'a' }]);
    const q = new Proximity(3, 4);
    expect(q.update(at(2), [{ id: 'b', tile: at(0) }, { id: 'c', tile: at(4) }])).toEqual([{ kind: 'open', id: 'b' }]);
  });

  it('moves from one agent to another by closing the first and opening the second', () => {
    const p = new Proximity(2, 3);
    const agents = [{ id: 'a', tile: at(0) }, { id: 'b', tile: at(10) }];
    p.update(at(1), agents);
    expect(p.update(at(9), agents)).toEqual([{ kind: 'close', id: 'a' }, { kind: 'open', id: 'b' }]);
  });

  it('closes when the agent it was watching is gone, and can be closed by hand', () => {
    const p = new Proximity(2, 3);
    p.update(at(1), [{ id: 'a', tile: at(0) }]);
    expect(p.update(at(1), [])).toEqual([{ kind: 'close', id: 'a' }]);
    p.update(at(1), [{ id: 'a', tile: at(0) }]);
    expect(p.close()).toEqual([{ kind: 'close', id: 'a' }]);
    expect(p.close()).toEqual([]);
  });

  it('can be opened from the agent list, and then stays until you walk away from it', () => {
    const p = new Proximity(2, 3);
    expect(p.open('a')).toEqual([{ kind: 'open', id: 'a' }]);
    expect(p.open('a')).toEqual([]);
    expect(p.update(at(20), [{ id: 'a', tile: at(0) }])).toEqual([]); // opened by hand: walking does not close it
    expect(p.close()).toEqual([{ kind: 'close', id: 'a' }]);
  });
});
