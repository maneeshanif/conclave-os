import { describe, expect, it } from 'vitest';
import { EMOTES, EMOTE_SHOWN_MS } from '@conclave/shared';
import { currentEmote, showEmote } from '../office/emotes';

describe('quick reactions over a head (S6-18)', () => {
  it('has a short list of emoji, each one character cluster, and no duplicates', () => {
    expect(EMOTES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(EMOTES).size).toBe(EMOTES.length);
  });

  it('shows an emoji for a few seconds and then stops, and a newer one replaces it', () => {
    let m = new Map<string, { emote: string; until: number }>();
    m = showEmote(m, 'a', '👋', 1000);
    expect(currentEmote(m, 'a', 1000)).toBe('👋');
    expect(currentEmote(m, 'a', 1000 + EMOTE_SHOWN_MS - 1)).toBe('👋');
    expect(currentEmote(m, 'a', 1000 + EMOTE_SHOWN_MS)).toBeNull();
    m = showEmote(m, 'a', '🎉', 2000);
    expect(currentEmote(m, 'a', 2500)).toBe('🎉');
    expect(currentEmote(m, 'nobody', 2500)).toBeNull();
  });

  it('ignores anything that is not on the list, and clears old ones out of the map', () => {
    let m = new Map<string, { emote: string; until: number }>();
    m = showEmote(m, 'a', '<b>', 0);
    expect(m.size).toBe(0);
    m = showEmote(m, 'a', '👍', 0);
    m = showEmote(m, 'b', '👍', 10_000);
    expect(m.has('a')).toBe(false); // a's ran out by the time b's was added
    expect(m.has('b')).toBe(true);
  });
});
