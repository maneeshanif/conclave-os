// @vitest-environment jsdom
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

describe('the worlds client (S6-17)', () => {
  afterEach(() => localStorage.clear());

  it('asks for the world you are in, and for none at the headquarters', async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify({ places: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await api.officeState();
    expect(String(fetchMock.mock.calls[0]![0])).not.toMatch(/world=/);
    localStorage.setItem('conclave.world', 'arcade');
    await api.officeState();
    expect(String(fetchMock.mock.calls[1]![0])).toMatch(/\/api\/office\/state\?world=arcade$/);
  });

  it('lists the worlds, and refuses an answer that is not a list', async () => {
    answer({ worlds: [{ key: 'hq', name: 'Headquarters', blurb: '' }] });
    expect((await api.officeWorlds())[0]!.key).toBe('hq');
    for (const body of [[], {}, { worlds: 'no' }, null]) {
      answer(body);
      await expect(api.officeWorlds(), JSON.stringify(body)).rejects.toThrow(/unexpected/i);
    }
  });
});

describe('the team client (S6-14b2)', () => {
  it('passes on a proper answer and refuses one that is not a list', async () => {
    answer({ team: [{ id: 'a', key: 'k', name: 'N', department: null, state: 'idle', since: null, task: null, forYou: 0 }] });
    expect((await api.officeTeam())[0]!.state).toBe('idle');
    for (const body of [[], {}, { team: 'no' }, null]) {
      answer(body);
      await expect(api.officeTeam(), JSON.stringify(body)).rejects.toThrow(/unexpected/i);
    }
  });
});

describe('the activity client (S6-14b3)', () => {
  it('passes on a proper answer and refuses one that is not a list', async () => {
    answer({ events: [{ id: 'a', at: '2026-11-16T10:00:00Z', kind: 'run.started', text: 'X started a run.' }] });
    expect((await api.officeActivity())[0]!.text).toBe('X started a run.');
    for (const body of [[], {}, { events: 'no' }, null]) {
      answer(body);
      await expect(api.officeActivity(), JSON.stringify(body)).rejects.toThrow(/unexpected/i);
    }
  });
});
