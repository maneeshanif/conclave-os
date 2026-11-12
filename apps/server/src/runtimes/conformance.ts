import type { OsStore } from '../harness/os-tools';
import type { RunTokens } from '../harness/run-tokens';
import type { RunEvent, RunRequest, Runtime } from './types';

/**
 * The runtime conformance suite (SPEC 5, the portability rule, rule 3). A runtime may serve
 * agents only after every case passes. Each case throws an Error with a plain message on failure.
 *
 * The harness under test is driven by `make(mode)`; modes are behaviours the test double or a
 * scripted model performs: ok, mcp, forbidden, env, limit, auth, hang.
 */
export interface ConformanceDeps {
  make(mode: 'ok' | 'mcp' | 'forbidden' | 'env' | 'limit' | 'auth' | 'hang'): Runtime;
  /** A fresh request with a rendered working folder whose MCP config points at `osUrl`. */
  request(over?: Partial<RunRequest>): Promise<RunRequest>;
  tokens: RunTokens;
  store: OsStore & { taskStatus(taskId: string): string | undefined };
  /** Server-side secrets that must never reach the agent process. */
  secretNames: string[];
  /** Creates a task the run may work on and returns its id. */
  newTask(workspaceId: string): string;
}

export interface ConformanceCase {
  point: number;
  name: string;
  run(deps: ConformanceDeps): Promise<void>;
}

async function collect(it: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

function fail(msg: string): never {
  throw new Error(msg);
}

function terminal(events: RunEvent[]): RunEvent {
  const ends = events.filter((e) => e.type === 'done' || e.type === 'error');
  if (ends.length !== 1) fail(`expected exactly one done or error event, got ${ends.length}`);
  if (events.at(-1) !== ends[0]) fail('the done or error event must be the last event');
  return ends[0]!;
}

async function withToken(deps: ConformanceDeps, over: Partial<RunRequest> = {}) {
  const base = await deps.request(over);
  const taskId = deps.newTask(base.workspaceId);
  const runToken = deps.tokens.issue({ workspaceId: base.workspaceId, agentId: base.agentId, runId: base.runId, taskId });
  return { req: { ...base, taskId, runToken }, taskId };
}

export const conformanceCases: ConformanceCase[] = [
  {
    point: 1,
    name: 'emits run events in order and ends with exactly one done',
    async run(deps) {
      const { req } = await withToken(deps);
      const events = await collect(deps.make('ok').start(req));
      if (events[0]?.type !== 'session') fail(`first event should be session, got ${events[0]?.type}`);
      const end = terminal(events);
      if (end.type !== 'done') fail(`expected done, got ${JSON.stringify(end)}`);
    },
  },
  {
    point: 2,
    name: 'calls an os tool with its run token and finishes its own task',
    async run(deps) {
      const { req, taskId } = await withToken(deps);
      const events = await collect(deps.make('mcp').start(req));
      terminal(events);
      const results = events.filter((e) => e.type === 'tool_result') as Extract<RunEvent, { type: 'tool_result' }>[];
      if (results.length < 2 || !results.every((r) => r.ok)) fail(`os tool calls failed: ${JSON.stringify(results)}`);
      const status = deps.store.taskStatus(taskId);
      if (status !== 'done') fail(`task should be done after complete_task, is ${status}`);
    },
  },
  {
    point: 3,
    name: 'is refused a tool it was not granted',
    async run(deps) {
      const { req } = await withToken(deps);
      const events = await collect(deps.make('forbidden').start(req));
      terminal(events);
      const results = events.filter((e) => e.type === 'tool_result') as Extract<RunEvent, { type: 'tool_result' }>[];
      if (!results.length) fail('the forbidden call produced no tool result');
      if (results.some((r) => r.ok)) fail(`a tool that was not granted succeeded: ${JSON.stringify(results)}`);
    },
  },
  {
    point: 4,
    name: 'receives no secret except its own model settings and run token',
    async run(deps) {
      const { req } = await withToken(deps);
      const events = await collect(deps.make('env').start(req));
      const end = terminal(events);
      if (end.type !== 'done') fail(`env probe failed: ${JSON.stringify(end)}`);
      const report = JSON.parse(end.output) as { keys: string[] };
      const leaked = deps.secretNames.filter((n) => report.keys.includes(n));
      if (leaked.length) fail(`secrets reached the agent process: ${leaked.join(', ')}`);
      if (JSON.stringify(events).includes(req.runToken)) fail('the run token appears in stored events');
    },
  },
  {
    point: 5,
    name: 'stops on cancel',
    async run(deps) {
      const { req } = await withToken(deps);
      const rt = deps.make('hang');
      const p = collect(rt.start(req));
      await new Promise((r) => setTimeout(r, 300));
      await rt.cancel(req.runId);
      const end = terminal(await p);
      if (end.type !== 'error' || end.kind !== 'cancelled') fail(`expected cancelled, got ${JSON.stringify(end)}`);
    },
  },
  {
    point: 6,
    name: 'maps a plan limit and a sign-in failure to their own error kinds',
    async run(deps) {
      for (const [mode, kind] of [
        ['limit', 'limit'],
        ['auth', 'auth'],
      ] as const) {
        const { req } = await withToken(deps);
        const end = terminal(await collect(deps.make(mode).start(req)));
        if (end.type !== 'error' || end.kind !== kind) fail(`${mode}: expected error kind ${kind}, got ${JSON.stringify(end)}`);
      }
    },
  },
  {
    point: 7,
    name: 'resumes a session when asked, or says it cannot',
    async run(deps) {
      const rt = deps.make('env');
      const sid = 'sess-resume-check';
      const { req } = await withToken(deps, { sessionId: sid });
      const end = terminal(await collect(rt.start(req)));
      if (end.type !== 'done') fail(`resume probe failed: ${JSON.stringify(end)}`);
      const args = (JSON.parse(end.output) as { args: string[] }).args;
      if (rt.canResume && !args.includes(sid)) fail('canResume is true but the session id was not passed to the harness');
    },
  },
];
