import { describe, expect, it } from 'vitest';
import { addChat, nearbyPeople, type ChatLine } from '../office/chat';

const p = (id: string, x: number, y: number) => ({ id, name: id.toUpperCase(), position: { x, y } });

describe('who is close enough to talk to (S6-15c)', () => {
  it('opens for people within 4 tiles, nearest first', () => {
    const near = nearbyPeople({ x: 10, y: 10 }, [p('b', 13, 10), p('a', 11, 10), p('far', 20, 20)], []);
    expect(near).toEqual(['a', 'b']);
  });

  it('keeps someone who steps a little further, and lets go past 5 tiles (no flicker at the edge)', () => {
    const me = { x: 10, y: 10 };
    expect(nearbyPeople(me, [p('a', 14.6, 10)], [])).toEqual([]); // not close enough to start
    expect(nearbyPeople(me, [p('a', 14.6, 10)], ['a'])).toEqual(['a']); // but still here once talking
    expect(nearbyPeople(me, [p('a', 15.5, 10)], ['a'])).toEqual([]);
  });

  it('closes when everyone has gone', () => {
    expect(nearbyPeople({ x: 0, y: 0 }, [], ['a'])).toEqual([]);
  });
});

describe('the chat lines (S6-15c)', () => {
  const line = (text: string, at = 1): ChatLine => ({ id: 'a', name: 'Ana', text, at, mine: false });

  it('adds a message from the server and keeps only the last 50', () => {
    let log: ChatLine[] = [];
    for (let i = 0; i < 60; i++) log = addChat(log, { kind: 'chat', id: 'a', name: 'Ana', text: `m${i}`, at: i });
    expect(log).toHaveLength(50);
    expect(log[0]!.text).toBe('m10');
    expect(log.at(-1)).toEqual({ id: 'a', name: 'Ana', text: 'm59', at: 59, mine: false });
  });

  it('ignores anything that is not a well-formed chat message', () => {
    const log = [line('x')];
    expect(addChat(log, { kind: 'presence' })).toBe(log);
    expect(addChat(log, { kind: 'chat', id: 'a', name: 'Ana', text: '', at: 1 })).toBe(log);
    expect(addChat(log, { kind: 'chat', id: 5, name: 'Ana', text: 'hi', at: 1 })).toBe(log);
    expect(addChat(log, { kind: 'chat', id: 'a', name: 'Ana', text: 'hi' })).toBe(log);
  });

  it('adds your own line as yours', () => {
    expect(addChat([], { kind: 'chat', id: 'me', name: 'You', text: 'hello', at: 5 }, true)[0]).toMatchObject({ mine: true, text: 'hello' });
  });
});
