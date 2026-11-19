import { describe, expect, it } from 'vitest';
import { createWorkflows } from '../src/workflows/inngest';

// What Inngest is told when the app registers: the ids, the triggers and the limits (SPEC 11, 14).
function registration() {
  const wf = createWorkflows({ execute: async () => ({ status: 'no_task' }), tickAll: async () => [] });
  const configs = wf.functions.flatMap((f) => {
    const fn = f as unknown as { getConfig(ctx: { baseUrl: URL; appPrefix: string }): unknown[] };
    return fn.getConfig({ baseUrl: new URL('http://127.0.0.1:3100/inngest'), appPrefix: 'conclave-os' });
  }) as { id: string; triggers: unknown[]; concurrency?: { limit: number; key?: string }[]; steps: { step: { retries: { attempts: number } } } }[];
  return Object.fromEntries(configs.map((c) => [c.id, c]));
}

describe('Inngest registration (S0-14)', () => {
  it('registers exactly the agent-run and ticker functions', () => {
    expect(Object.keys(registration()).sort()).toEqual(['conclave-os-agent-run', 'conclave-os-ticker']);
  });

  it('agent-run starts on agent/run.requested, at most two runs at once and one per agent', () => {
    const run = registration()['conclave-os-agent-run']!;
    expect(run.triggers).toEqual([{ event: 'agent/run.requested' }]);
    expect(run.concurrency).toEqual([{ limit: 2 }, { limit: 1, key: 'event.data.agentId' }]);
  });

  it('a failed run is not retried: a person decides what happens next', () => {
    const run = registration()['conclave-os-agent-run']!;
    expect(run.steps.step.retries.attempts).toBe(0);
  });

  it('the ticker fires every minute', () => {
    expect(registration()['conclave-os-ticker']!.triggers).toEqual([{ cron: '* * * * *' }]);
  });
});
