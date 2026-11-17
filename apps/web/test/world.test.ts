// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventsUrl, setCurrentCompany } from '../lib/company';
import { currentWorld, setCurrentWorld, worldQuery } from '../lib/world';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('which world this browser is in (S6-17)', () => {
  it('is the headquarters until you choose another, and remembers the choice', () => {
    expect(currentWorld()).toBe('hq');
    expect(worldQuery()).toBe('');
    setCurrentWorld('campus');
    expect(currentWorld()).toBe('campus');
    expect(worldQuery()).toBe('world=campus');
    setCurrentWorld('hq');
    expect(currentWorld()).toBe('hq');
    expect(localStorage.getItem('conclave.world')).toBeNull();
  });

  it('ignores a stored value that is not a plain key', () => {
    for (const bad of ['../x', 'A B', '', 'x'.repeat(40)]) {
      localStorage.setItem('conclave.world', bad);
      expect(currentWorld(), bad).toBe('hq');
    }
  });

  it('is named in the live socket address, beside the company', () => {
    expect(eventsUrl('http://127.0.0.1:4000')).toBe('ws://127.0.0.1:4000/events');
    setCurrentWorld('loft');
    expect(eventsUrl('http://127.0.0.1:4000')).toBe('ws://127.0.0.1:4000/events?world=loft');
    setCurrentCompany('123e4567-e89b-12d3-a456-426614174000');
    expect(eventsUrl('http://127.0.0.1:4000')).toBe('ws://127.0.0.1:4000/events?company=123e4567-e89b-12d3-a456-426614174000&world=loft');
  });
});
