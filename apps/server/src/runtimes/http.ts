import type { ErrorKind, RunEvent, RunRequest, Runtime, RuntimeHealth } from './types';

/**
 * The `http` runtime (SPEC 7, slice 9): POSTs the task to a worker at a URL and reads back the run's events. For workers written in other
 * languages and run on their own: Python services, a Hermes agent, a model host. There is no per-agent code here; the worker is generic.
 *
 * What the worker is sent: the run id, the agent key, the standing instructions and this run's context, the task, the session to resume,
 * the `os` endpoint and the run's own token (it calls back into the `os` tools like any harness does). Nothing else leaves: no environment,
 * no server secret. What it may answer with: lines of JSON run events (`application/x-ndjson`), or one JSON object `{ "output": "..." }`.
 * A worker is on this machine unless the server was told that remote workers are allowed, because a task is data (rule 4).
 */
export interface HttpRuntimeOptions {
  /** The worker's address, or a function that picks it for a request (by agent key or model alias). */
  url: string | ((req: RunRequest) => string | undefined);
  /** The os MCP endpoint, such as http://127.0.0.1:3100/mcp. The worker calls it with the run token as a bearer token. */
  osUrl: string;
  /** A worker on another machine is refused unless this is set. */
  allowRemote?: boolean;
  /** A key for the worker itself, sent as a bearer token. The only secret this runtime sends, and only if it is given. */
  workerKey?: string;
  /** Reads the standing instructions the renderer wrote for the agent. Defaults to nothing. */
  instructionsFor?: (req: RunRequest) => Promise<string>;
}

const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\])$/;
const TYPES = new Set(['session', 'thinking', 'message', 'tool_call', 'tool_result', 'cost', 'done', 'error']);
const KINDS = new Set<ErrorKind>(['runtime', 'limit', 'auth', 'timeout', 'max_turns', 'cancelled', 'config', 'output_check', 'silent']);

/** One line from the worker as a run event, or null if it is not one. The worker is outside the process, so nothing is trusted. */
export function toEvent(raw: unknown): RunEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const type = e.type;
  if (typeof type !== 'string' || !TYPES.has(type)) return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  switch (type) {
    case 'session':
      return { type, sessionId: str(e.sessionId) };
    case 'thinking':
    case 'message':
      return { type, text: str(e.text) };
    case 'tool_call':
      return { type, tool: str(e.tool), input: e.input ?? null };
    case 'tool_result':
      return { type, tool: str(e.tool), ok: e.ok === true, summary: str(e.summary) };
    case 'cost':
      return { type, usd: num(e.usd), tokensIn: num(e.tokensIn), tokensOut: num(e.tokensOut) };
    case 'done':
      return { type, output: str(e.output), ...(typeof e.sessionId === 'string' ? { sessionId: e.sessionId } : {}) };
    default:
      return { type: 'error', kind: KINDS.has(e.kind as ErrorKind) ? (e.kind as ErrorKind) : 'runtime', message: str(e.message) || 'The worker reported an error.' };
  }
}

export function createHttpRuntime(o: HttpRuntimeOptions): Runtime {
  const live = new Map<string, AbortController>();
  const cancelled = new Set<string>();

  async function* start(req: RunRequest): AsyncIterable<RunEvent> {
    const redact = (s: string) => (req.runToken ? s.split(req.runToken).join('[token]') : s);
    const fail = (kind: ErrorKind, message: string): RunEvent => ({ type: 'error', kind, message: redact(message) });
    const url = typeof o.url === 'function' ? o.url(req) : o.url;
    if (!url) {
      yield fail('config', `No worker address is set for the agent "${req.agentKey}".`);
      return;
    }
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      yield fail('config', `The worker address "${url}" is not a web address.`);
      return;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      yield fail('config', 'A worker address must be http or https.');
      return;
    }
    if (!LOCAL.test(target.hostname) && !o.allowRemote) {
      yield fail('config', `The worker is at ${target.hostname}, which is not on this machine. Remote workers are off unless the server is told to allow them.`);
      return;
    }

    const ctl = new AbortController();
    live.set(req.runId, ctl);
    const timeout = setTimeout(() => ctl.abort(new Error('timeout')), req.timeoutMs ?? 15 * 60_000);
    const body = JSON.stringify({
      runId: req.runId,
      agentKey: req.agentKey,
      ...(req.taskId ? { taskId: req.taskId } : {}),
      standing: o.instructionsFor ? await o.instructionsFor(req).catch(() => '') : '',
      instructions: req.instructions,
      task: req.taskInput,
      ...(req.sessionId ? { sessionId: req.sessionId } : {}),
      maxTurns: req.maxTurns,
      os: { url: o.osUrl, token: req.runToken },
    });
    let ended = false;
    try {
      const res = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/x-ndjson, application/json', ...(o.workerKey ? { authorization: `Bearer ${o.workerKey}` } : {}) }, body, signal: ctl.signal });
      if (res.status === 429) return void (yield fail('limit', 'The worker is rate limited (429).'));
      if (res.status === 401 || res.status === 403) return void (yield fail('auth', `The worker refused the request (${res.status}).`));
      if (!res.ok) return void (yield fail('runtime', `The worker answered ${res.status}.`));
      const type = res.headers.get('content-type') ?? '';
      if (!type.includes('ndjson')) {
        const j = (await res.json().catch(() => null)) as { output?: unknown; sessionId?: unknown } | null;
        if (!j || typeof j.output !== 'string') return void (yield fail('runtime', 'The worker answered with something that is not a result.'));
        yield { type: 'session', sessionId: typeof j.sessionId === 'string' ? j.sessionId : req.runId };
        yield { type: 'done', output: redact(j.output) };
        ended = true;
        return;
      }
      let first = true;
      let buf = '';
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      const lines = function* (chunk: string): Generator<string> {
        buf += chunk;
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const l = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (l) yield l;
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        const batch = done ? [...lines(`${dec.decode()}\n`)] : [...lines(dec.decode(value, { stream: true }))];
        for (const l of batch) {
          let e: RunEvent | null = null;
          try {
            e = toEvent(JSON.parse(l));
          } catch {
            e = null;
          }
          if (!e) continue;
          if (first && e.type !== 'session') yield { type: 'session', sessionId: req.runId };
          first = false;
          const clean = JSON.parse(redact(JSON.stringify(e))) as RunEvent;
          yield clean;
          if (e.type === 'done' || e.type === 'error') {
            ended = true;
            return;
          }
        }
        if (done) break;
      }
      if (!ended) yield fail('runtime', 'The worker stopped without a result.');
    } catch (err) {
      if (cancelled.has(req.runId)) yield fail('cancelled', 'The run was cancelled.');
      else if (ctl.signal.aborted) yield fail('timeout', 'The run took too long and was stopped.');
      else yield fail('runtime', `The worker at ${target.host} cannot be reached: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timeout);
      live.delete(req.runId);
      cancelled.delete(req.runId);
    }
  }

  return {
    name: 'http',
    canResume: true,
    start,
    async cancel(runId: string) {
      cancelled.add(runId);
      live.get(runId)?.abort(new Error('cancelled'));
    },
    async health(): Promise<RuntimeHealth> {
      return { ok: true, detail: 'Workers are checked when a run starts.' };
    },
  };
}
