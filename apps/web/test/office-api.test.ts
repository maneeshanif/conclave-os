import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';

afterEach(() => vi.unstubAllGlobals());
const answer = (body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })));

describe('the office client (S6-12c)', () => {
  it('passes on a proper answer', async () => {
    answer({ map: { rooms: [], objects: [], desks: [], entries: [], walls: [], width: 1, height: 1, tile: 32 }, agents: [] });
    expect((await api.office()).agents).toEqual([]);
  });

  it('refuses an answer that is not an office, so a bad reply shows as an error and cannot break the page around it', async () => {
    for (const body of [[], {}, null, { map: {} }, { map: { rooms: 'no' } }]) {
      answer(body);
      await expect(api.office(), JSON.stringify(body)).rejects.toThrow(/unexpected/i);
    }
  });

  it('refuses a list of places that is not a list', async () => {
    answer({ places: 'nope' });
    await expect(api.officeState()).rejects.toThrow(/unexpected/i);
  });
});
