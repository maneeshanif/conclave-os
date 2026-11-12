import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCliRuntime } from '../src/runtimes/cli';
import type { RunEvent, RunRequest } from '../src/runtimes/types';

const fake = path.join(__dirname, 'fixtures', 'fake-cli.mjs');
const SECRET_ENV = { RESEND_API_KEY: 'sk_live_secret', DATABASE_URL: 'postgres://x', ANTHROPIC_API_KEY: 'sk-ant-x', SECRETS_KEY: 'k' };

function runtime(flavor: 'claude-cli' | 'opencode', mode: string) {
  return createCliRuntime(flavor, {
    command: { command: process.execPath, prefixArgs: [fake, flavor === 'claude-cli' ? 'claude' : 'opencode', mode] },
    baseEnv: { ...process.env, ...SECRET_ENV },
  });
}

async function request(over: Partial<RunRequest> = {}): Promise<RunRequest> {
  return {
    runId: `run-${Math.random().toString(36).slice(2)}`,
    workspaceId: 'ws',
    agentId: 'agent-uuid',
    agentKey: 'researcher',
    instructions: 'Context for this run.',
    taskInput: 'List five facts.',
    workspaceDir: await mkdtemp(path.join(tmpdir(), 'conclave-run-')),
    modelAlias: over.modelAlias ?? 'researcher',
    maxTurns: 10,
    runToken: 'tok_secret_abc123',
    ...over,
  };
}

async function collect(it: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const last = (events: RunEvent[]) => events[events.length - 1];

for (const flavor of ['claude-cli', 'opencode'] as const) {
  const alias = flavor === 'claude-cli' ? 'researcher' : 'any-model';
  describe(`CLI runtime: ${flavor} (S0-6)`, () => {
    it('turns canned JSON lines into events in order and ends done', async () => {
      const events = await collect(runtime(flavor, 'ok').start(await request({ modelAlias: alias })));
      const types = events.map((e) => e.type);
      expect(types[0]).toBe('session');
      expect(types).toContain('tool_call');
      expect(types.indexOf('tool_call')).toBeLessThan(types.indexOf('tool_result'));
      expect(last(events)).toMatchObject({ type: 'done', output: 'All done.' });
      expect(events.filter((e) => e.type === 'done' || e.type === 'error')).toHaveLength(1);
    });

    it('ends with a runtime error when the CLI exits non-zero', async () => {
      const events = await collect(runtime(flavor, 'fail').start(await request({ modelAlias: alias })));
      expect(last(events)).toMatchObject({ type: 'error', kind: 'runtime' });
      expect((last(events) as { message: string }).message).toContain('boom');
    });

    it('classifies a plan or rate limit as its own kind', async () => {
      const events = await collect(runtime(flavor, 'limit').start(await request({ modelAlias: alias })));
      expect(last(events)).toMatchObject({ type: 'error', kind: 'limit' });
    });

    it('classifies a sign-in failure as auth', async () => {
      const events = await collect(runtime(flavor, 'auth').start(await request({ modelAlias: alias })));
      expect(last(events)).toMatchObject({ type: 'error', kind: 'auth' });
    });

    it('starts the child with a clean environment: no server secrets, only the run token', async () => {
      const events = await collect(runtime(flavor, 'env').start(await request({ modelAlias: alias })));
      const done = last(events);
      expect(done?.type).toBe('done');
      const report = JSON.parse((done as { output: string }).output) as { keys: string[]; args: string[]; stdin: string };
      for (const k of Object.keys(SECRET_ENV)) expect(report.keys).not.toContain(k);
      expect(report.keys).toContain('CONCLAVE_RUN_TOKEN');
      expect(report.args.join(' ')).not.toContain('List five facts'); // the prompt never goes on the command line
    });

    it('redacts the run token from every stored event', async () => {
      const events = await collect(runtime(flavor, 'token').start(await request({ modelAlias: alias })));
      expect(JSON.stringify(events)).not.toContain('tok_secret_abc123');
      expect(JSON.stringify(events)).toContain('***');
    });

    it('stops a run that goes past max turns', async () => {
      const events = await collect(runtime(flavor, 'turns').start(await request({ modelAlias: alias, maxTurns: 5 })));
      expect(last(events)).toMatchObject({ type: 'error', kind: 'max_turns' });
    });

    it('stops on cancel', async () => {
      const rt = runtime(flavor, 'hang');
      const req = await request({ modelAlias: alias });
      const p = collect(rt.start(req));
      await new Promise((r) => setTimeout(r, 300));
      await rt.cancel(req.runId);
      expect(last(await p)).toMatchObject({ type: 'error', kind: 'cancelled' });
    });

    it('times out a run that never finishes', async () => {
      const events = await collect(runtime(flavor, 'hang').start(await request({ modelAlias: alias, timeoutMs: 400 })));
      expect(last(events)).toMatchObject({ type: 'error', kind: 'timeout' });
    });
  });
}
