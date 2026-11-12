import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/commands/doctor';
import { dispatchLimit, resolveLite } from '../src/config';
import { LocalDispatcher, type RunRequestEvent } from '../src/workflows/dispatch';
import { agentRunConcurrency } from '../src/workflows/inngest';
import { singleFlight } from '../src/workflows/single-flight';

const ev = (agentId: string): RunRequestEvent => ({ workspaceId: 'w', agentId, trigger: 'manual' });

describe('lite mode (S3-10)', () => {
  it('is off unless LITE is 1 or true', () => {
    expect(resolveLite({})).toBe(false);
    expect(resolveLite({ LITE: '' })).toBe(false);
    expect(resolveLite({ LITE: '0' })).toBe(false);
    expect(resolveLite({ LITE: '1' })).toBe(true);
    expect(resolveLite({ LITE: 'true' })).toBe(true);
    expect(resolveLite({ LITE: ' TRUE ' })).toBe(true);
  });

  it('allows one run at a time in lite and two by default', () => {
    expect(dispatchLimit({ LITE: '1' })).toBe(1);
    expect(dispatchLimit({})).toBe(2);
  });

  /** Runs three agents and reports the most that were ever running at once. */
  async function peak(limit: number) {
    let now = 0;
    let most = 0;
    const d = new LocalDispatcher(async () => {
      now++;
      most = Math.max(most, now);
      await new Promise((r) => setTimeout(r, 25));
      now--;
      return { status: 'no_task' };
    }, limit);
    for (const a of ['a', 'b', 'c']) await d.request(ev(a));
    await d.idle();
    return most;
  }
  it('the dispatcher runs at most one agent at a time in lite, and two by default', async () => {
    expect(await peak(dispatchLimit({ LITE: '1' }))).toBe(1);
    expect(await peak(dispatchLimit({}))).toBe(2);
  });

  it('the Inngest run function is held to one at a time in lite and keeps its two limits by default', () => {
    expect(agentRunConcurrency(true)).toEqual([{ limit: 1 }]);
    expect(agentRunConcurrency(false)).toEqual([{ limit: 2 }, { limit: 1, key: 'event.data.agentId' }]);
  });

  it('a ticker task never overlaps itself: a tick that arrives while one runs is skipped', async () => {
    let running = 0;
    let most = 0;
    let calls = 0;
    const tick = singleFlight(async () => {
      calls++;
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 30));
      running--;
      return ['woken'];
    }, []);
    const results = await Promise.all([tick(), tick(), tick()]);
    expect(most).toBe(1);
    expect(calls).toBe(1);
    expect(results).toEqual([['woken'], [], []]);
    expect(await tick()).toEqual(['woken']); // free again afterwards
  });

  it('a ticker task that throws does not leave the next one blocked', async () => {
    let n = 0;
    const tick = singleFlight(async () => {
      if (n++ === 0) throw new Error('boom');
      return ['ok'];
    }, []);
    await expect(tick()).rejects.toThrow('boom');
    expect(await tick()).toEqual(['ok']);
  });

  const env = (extra: Record<string, string> = {}) => ({ DATA_DIR: path.join(tmpdir(), 'conclave-lite-doctor'), ...extra });
  it('doctor says which mode it is in, and how much memory the machine has', async () => {
    const lite = (await runChecks(env({ LITE: '1' }))).find((c) => c.name === 'mode')!;
    expect(lite.level).toBe('ok');
    expect(lite.detail).toMatch(/lite/i);
    expect(lite.detail).toMatch(/one run at a time/i);
    expect(lite.detail).toMatch(/\d+(\.\d)? GB/);
    const normal = (await runChecks(env())).find((c) => c.name === 'mode')!;
    expect(normal.detail).toMatch(/normal/i);
    expect(normal.detail).not.toMatch(/^lite/i);
  }, 60_000);
});
