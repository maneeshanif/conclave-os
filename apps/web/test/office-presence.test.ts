import { describe, expect, it } from 'vitest';
import { applyPresence, type Member } from '../office/presence';

const m = (id: string, x = 1, y = 1, over: Partial<Member> = {}): Member => ({ id, name: 'Guest', x, y, availability: 'available', handRaised: false, ...over });

describe('keeping the list of other people (S6-9)', () => {
  it('adds and moves someone on a presence message', () => {
    let list: Member[] = [];
    list = applyPresence(list, { kind: 'presence', member: m('a', 1, 1) });
    list = applyPresence(list, { kind: 'presence', member: m('a', 4, 5, { handRaised: true }) });
    expect(list).toEqual([m('a', 4, 5, { handRaised: true })]);
  });

  it('takes everyone from a presence.all message, replacing what it had', () => {
    const list = applyPresence([m('old')], { kind: 'presence.all', members: [m('a'), m('b')] });
    expect(list.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('removes someone who leaves, and ignores one it never knew', () => {
    const list = applyPresence([m('a'), m('b')], { kind: 'presence.leave', id: 'a' });
    expect(list.map((x) => x.id)).toEqual(['b']);
    expect(applyPresence(list, { kind: 'presence.leave', id: 'zzz' })).toEqual(list);
  });

  it('ignores messages that are not about presence, and ones that are malformed', () => {
    const list = [m('a')];
    expect(applyPresence(list, { kind: 'task.changed' })).toBe(list);
    expect(applyPresence(list, { kind: 'presence', member: { id: 5 } })).toBe(list);
    expect(applyPresence(list, { kind: 'presence.all', members: 'nope' })).toBe(list);
    expect(applyPresence(list, { kind: 'presence', member: { ...m('b'), x: 1.5 } })).toBe(list);
  });
});
