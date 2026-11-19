import { describe, expect, it } from 'vitest';
import { cleanName, readProfile, writeProfile } from '../office/profile';

const store = (init: Record<string, string> = {}) => {
  const data = { ...init };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) } as unknown as Storage & { data: Record<string, string> };
};

describe('your name and look (S6-15b)', () => {
  it('trims the name, drops markup and control characters, and keeps it short', () => {
    expect(cleanName('  Anees  ')).toBe('Anees');
    expect(cleanName('<b>Hi</b>\u0007 there')).toBe('bHi/b there');
    expect(cleanName('x'.repeat(80))).toHaveLength(30);
    expect(cleanName('   ')).toBe('Guest');
  });

  it('starts as a guest with the first look, and keeps what you chose', () => {
    const s = store();
    expect(readProfile(s)).toEqual({ name: 'Guest', look: 0 });
    writeProfile(s, { name: ' Sam ', look: 3 });
    expect(readProfile(s)).toEqual({ name: 'Sam', look: 3 });
  });

  it('ignores a look outside 0 to 5 and a broken saved value', () => {
    writeProfile(store(), { name: 'x', look: 9 }); // does not throw
    const s = store();
    writeProfile(s, { name: 'Sam', look: 9 });
    expect(readProfile(s).look).toBe(0);
    expect(readProfile(store({ 'conclave.office.profile': '{nope' }))).toEqual({ name: 'Guest', look: 0 });
  });

  it('works with no storage at all', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(readProfile(broken)).toEqual({ name: 'Guest', look: 0 });
    expect(() => writeProfile(broken, { name: 'a', look: 1 })).not.toThrow();
  });
});
