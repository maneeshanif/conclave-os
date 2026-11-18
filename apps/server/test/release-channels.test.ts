import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { compareVersions, newestFor, planUpgrade, type Release } from '../src/release/channels';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

/** Release channels (A6): stable, beta and nightly, with a smoke gate before any upgrade. */
const R: Release[] = [
  { version: '1.4.0', channel: 'stable' },
  { version: '1.5.0-beta.1', channel: 'beta' },
  { version: '1.5.0-beta.2', channel: 'beta' },
  { version: '1.5.0', channel: 'stable' },
  { version: '1.6.0-beta.1', channel: 'beta' },
  { version: '1.6.0-nightly.20261120', channel: 'nightly' },
];
const pass = async () => ({ ok: true, reasons: [] as string[] });

describe('versions', () => {
  it('compare by number, with a suffixed release older than the plain one', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.5.0', '1.5.0-beta.2')).toBe(1);
    expect(compareVersions('1.5.0-beta.2', '1.5.0-beta.10')).toBe(-1);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
  });
});

describe('which release a channel sees (A6)', () => {
  it('lets stable see only stable, beta see beta and stable, and nightly see all', () => {
    expect(newestFor('stable', '1.3.0', R)?.version).toBe('1.5.0');
    expect(newestFor('beta', '1.3.0', R)?.version).toBe('1.6.0-beta.1');
    expect(newestFor('nightly', '1.3.0', R)?.version).toBe('1.6.0-nightly.20261120');
    expect(newestFor('stable', '1.5.0', R)).toBeNull();
    expect(newestFor('beta', '1.6.0-beta.1', R)).toBeNull();
  });
});

describe('planning an upgrade (A6)', () => {
  it('goes to the newest release in the channel when the smoke gate passes, and never goes back', async () => {
    expect(await planUpgrade({ channel: 'stable', current: '1.4.0', releases: { releases: R }, smoke: pass })).toEqual({ action: 'upgrade', release: { version: '1.5.0', channel: 'stable' } });
    expect((await planUpgrade({ channel: 'stable', current: '1.5.0', releases: { releases: R }, smoke: pass })).action).toBe('none');
    expect((await planUpgrade({ channel: 'stable', current: '2.0.0', releases: { releases: R }, smoke: pass })).action).toBe('none');
  });

  it('is blocked, with why, when the smoke gate fails, and a gate that breaks counts as a failure', async () => {
    const failing = await planUpgrade({ channel: 'beta', current: '1.4.0', releases: { releases: R }, smoke: async () => ({ ok: false, reasons: ['doctor: the database does not migrate'] }) });
    expect(failing).toEqual({ action: 'blocked', release: { version: '1.6.0-beta.1', channel: 'beta' }, reasons: ['doctor: the database does not migrate'] });
    const broken = await planUpgrade({ channel: 'stable', current: '1.4.0', releases: { releases: R }, smoke: async () => Promise.reject(new Error('no disk')) });
    expect(broken).toMatchObject({ action: 'blocked', reasons: [expect.stringMatching(/could not run: no disk/)] });
    expect(await planUpgrade({ channel: 'stable', current: '1.4.0', releases: { releases: R }, smoke: async () => ({ ok: false, reasons: [] }) })).toMatchObject({ action: 'blocked', reasons: ['the smoke check failed'] });
  });

  it('does not run the gate when there is nothing to move to', async () => {
    let ran = 0;
    await planUpgrade({ channel: 'stable', current: '1.5.0', releases: { releases: R }, smoke: async () => (ran++, { ok: true, reasons: [] }) });
    expect(ran).toBe(0);
  });

  it('refuses a list that is not valid, and a running version that is not a version', async () => {
    expect((await planUpgrade({ channel: 'stable', current: '1.4.0', releases: { releases: [{ version: 'latest', channel: 'stable' }] }, smoke: pass })).action).toBe('none');
    expect(await planUpgrade({ channel: 'stable', current: '1.4.0', releases: { releases: [{ version: '1.5.0', channel: 'edge' }] }, smoke: pass })).toMatchObject({ action: 'none', why: expect.stringMatching(/not valid/) });
    expect(await planUpgrade({ channel: 'stable', current: 'abc', releases: { releases: R }, smoke: pass })).toMatchObject({ action: 'none', why: expect.stringMatching(/not a version/) });
    expect((await planUpgrade({ channel: 'stable', current: '1.4.0', releases: 'nonsense', smoke: pass })).action).toBe('none');
  });
});

describe('the channel setting (Settings, A6)', () => {
  let sys: System;
  let app: ReturnType<typeof createApp>;
  const json = { 'content-type': 'application/json' };
  beforeAll(async () => {
    ({ sys } = await testSystem());
    app = createApp({ pool: sys.app, workspaceId: sys.workspace.id, tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
  }, 240_000);
  afterAll(() => sys?.close());

  it('starts on stable, can be changed to beta or nightly, and refuses a name that is not a channel', async () => {
    const get = async () => ((await (await app.request('/api/config')).json()) as { releaseChannel: string }).releaseChannel;
    expect(await get()).toBe('stable');
    expect((await app.request('/api/config/release-channel', { method: 'PUT', headers: json, body: JSON.stringify({ channel: 'beta' }) })).status).toBe(200);
    expect(await get()).toBe('beta');
    expect((await app.request('/api/config/release-channel', { method: 'PUT', headers: json, body: JSON.stringify({ channel: 'edge' }) })).status).toBe(400);
    expect(await get()).toBe('beta');
    await withWorkspace(sys.app, sys.workspace.id, ({ client }) => client.query("update workspace_settings set release_channel = 'stable'"));
  });
});
