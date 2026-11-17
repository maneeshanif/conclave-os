// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ambientFor, reducedMotion } from '../office/ambient';
import { readSoundSettings, soundFor, speakable, writeSoundSettings } from '../office/sound';
import { signText, signsFor } from '../office/signs';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('what moves in the world (S6B-4)', () => {
  it('steams over coffee machines, sways plants and trees, flickers arcade screens, and leaves the rest still', () => {
    expect(ambientFor('coffee')).toBe('steam');
    expect(ambientFor('plant')).toBe('sway');
    expect(ambientFor('tree')).toBe('sway');
    expect(ambientFor('arcade')).toBe('flicker');
    expect(ambientFor('pingpong')).toBe('ball');
    for (const still of ['desk', 'chair', 'sofa', 'rug', 'bookshelf', 'nonsense']) expect(ambientFor(still), still).toBeNull();
  });

  it('is off for someone who asked their system for less motion', () => {
    const asks = (matches: boolean) => ({ matchMedia: () => ({ matches }) }) as unknown as Window;
    expect(reducedMotion(asks(true))).toBe(true);
    expect(reducedMotion(asks(false))).toBe(false);
  });
});

describe('sound in the office (S6B-5)', () => {
  it('picks one sound for each thing that happens, and none for what it does not know', () => {
    expect(soundFor('step')).toBe('step');
    expect(soundFor('enter-room')).toBe('door');
    expect(soundFor('chat')).toBe('blip');
    expect(soundFor('emote')).toBe('pop');
    expect(soundFor('needs-you')).toBe('ping');
    expect(soundFor('whatever')).toBeNull();
  });

  it('starts silent, remembers what you choose, and ignores a broken saved value', () => {
    expect(readSoundSettings()).toEqual({ effects: false, voice: false });
    writeSoundSettings({ effects: true, voice: false });
    expect(readSoundSettings()).toEqual({ effects: true, voice: false });
    localStorage.setItem('conclave.sound', '{nope');
    expect(readSoundSettings()).toEqual({ effects: false, voice: false });
  });

  it('reads a message aloud only when asked, with markup and control characters taken out and a limit on length', () => {
    expect(speakable('Ana', 'hello there', { effects: true, voice: false })).toBeNull();
    expect(speakable('Ana', 'hello there', { effects: false, voice: true })).toBe('Ana says: hello there');
    expect(speakable('Ana', '<b>hi</b>\u0007 you', { effects: false, voice: true })).toBe('Ana says: bhi/b you');
    expect(speakable('Ana', 'x'.repeat(500), { effects: false, voice: true })!.length).toBeLessThanOrEqual(160);
    expect(speakable('Ana', '   ', { effects: false, voice: true })).toBeNull();
  });
});

describe('names on signs (S6B-2)', () => {
  const room = (name: string, kind: string, w = 9) => ({ name, kind, department: kind === 'department' ? name.toLowerCase().replace(/ /g, '-') : null, x: 0, y: 0, w, h: 6 });

  it('writes a room name in capitals, and drops the district from a district room', () => {
    expect(signText('Chief of Staff')).toBe('CHIEF OF STAFF');
    expect(signText('Campus Green: Cafe')).toBe('CAFE');
  });

  it('gives every department room a sign with its name, and skips rooms too small to hold one', () => {
    const signs = signsFor([room('Outreach', 'department'), room('Lead Gen', 'department'), room('Pod 1', 'meeting', 2), room('Hall', 'hall', 8)]);
    expect(signs.filter((s) => s.department).map((s) => s.text)).toEqual(['OUTREACH', 'LEAD GEN']);
    expect(signs.some((s) => s.text === 'POD 1')).toBe(false);
    expect(signs.find((s) => s.text === 'HALL')).toBeTruthy();
  });

  it('puts a banner for each district over the street', () => {
    const rooms = [
      room('Chief of Staff', 'department'),
      { ...room('Campus Green: Cafe', 'cafe', 10), x: 5, y: 34 },
      { ...room('Campus Green: Library', 'lounge', 10), x: 20, y: 40 },
      { ...room('Game Night: Arcade', 'play', 22), x: 70, y: 34 },
    ];
    const banners = signsFor(rooms).filter((s) => s.banner);
    expect(banners.map((b) => b.text).sort()).toEqual(['CAMPUS GREEN', 'GAME NIGHT']);
    const campus = banners.find((b) => b.text === 'CAMPUS GREEN')!;
    expect(campus.x).toBeCloseTo((5 + 30) / 2, 5); // the middle of the district's rooms
    expect(campus.y).toBe(34 - 2); // on the street, just above the district
  });
});

describe('how an agent looks (S6B-3, S6B-4)', () => {
  it('shows one small mood over each state, and none for an unknown one', async () => {
    const { moodFor } = await import('../office/mood');
    expect(moodFor('working')).toBe('⌨️');
    expect(moodFor('waiting')).toBe('⏳');
    expect(moodFor('blocked')).toBe('⛔');
    expect(moodFor('discussion')).toBe('💬');
    expect(moodFor('handoff')).toBe('📨');
    expect(moodFor('idle')).toBe('💤');
    expect(moodFor('nonsense')).toBeNull();
    expect(moodFor(undefined)).toBeNull();
  });

  it('types with a small quick bob only while working, and blinks for a moment now and then', async () => {
    const { typingBob, blinking } = await import('../office/mood');
    expect(typingBob('idle', 1234)).toBe(0);
    const bobs = new Set([0, 100, 200, 300, 400].map((t) => typingBob('working', t)));
    expect(bobs.size).toBeGreaterThan(1);
    for (const b of bobs) expect(Math.abs(b)).toBeLessThanOrEqual(1);
    // Open for most of a four second cycle, shut for a moment.
    let shut = 0;
    for (let t = 0; t < 4000; t += 20) if (blinking(t, 0)) shut++;
    expect(shut).toBeGreaterThan(0);
    expect(shut).toBeLessThan(15);
  });

  it('pings when something new needs you, and not when the count stays or falls', async () => {
    const { needsYouRose } = await import('../office/mood');
    expect(needsYouRose(null, 3)).toBe(false); // the first look is not news
    expect(needsYouRose(2, 3)).toBe(true);
    expect(needsYouRose(3, 3)).toBe(false);
    expect(needsYouRose(3, 1)).toBe(false);
  });
});
