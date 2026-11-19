import { claudeParser } from './parsers';
import { RUN_TOKEN_ENV, type ErrorKind, type RunEvent, type RunRequest, type Runtime, type RuntimeHealth } from './types';

/**
 * The `claude-agent` runtime (SPEC 7, slice 9): the Claude Agent SDK hosted by the OS, for higher volume, team mode and people the OS is given
 * to. It needs an API key, which belongs to the person running the server: signed-in plan logins are never used here (Anthropic does not allow
 * a product built on the SDK to offer them). The key is handed to the SDK as its own environment and goes nowhere else.
 *
 * The SDK is injected as `query`, so the runtime is tested with a scripted one and the real package is loaded only when it is installed
 * (`loadAgentSdk`). Options follow the SDK's documented shape (checked against its docs for S9-2): `systemPrompt`, `allowedTools`,
 * `disallowedTools`, `permissionMode: 'dontAsk'`, `settingSources: []` (nothing is read from a folder: no CLAUDE.md, no hooks, no project
 * MCP file), `mcpServers`, `maxTurns`, `model`, `resume`, `cwd`, `env` and `abortController`. The messages it yields have the same shape as
 * Claude Code's stream-json, so the same parser reads them.
 */
export type SdkMessage = Record<string, unknown>;
export type SdkQuery = (args: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<SdkMessage>;

export interface ClaudeAgentOptions {
  osUrl: string;
  /** The person's own Anthropic API key. Without one, every run is refused with a plain message. */
  apiKey?: string;
  query?: SdkQuery;
  /** The model name to give the SDK for a request. Defaults to the SDK's own choice. */
  modelFor?: (req: RunRequest) => string | undefined;
  /** Reads the standing instructions the renderer wrote. */
  instructionsFor?: (req: RunRequest) => Promise<string>;
}

/** Loads the real SDK if the package is installed. A variable specifier keeps this file free of a hard dependency. */
export async function loadAgentSdk(): Promise<SdkQuery | null> {
  const name = '@anthropic-ai/claude-agent-sdk';
  try {
    const mod = (await import(/* @vite-ignore */ name)) as { query?: SdkQuery };
    return typeof mod.query === 'function' ? mod.query : null;
  } catch {
    return null;
  }
}

export function createClaudeAgentRuntime(o: ClaudeAgentOptions): Runtime {
  const live = new Map<string, AbortController>();
  const cancelled = new Set<string>();

  async function* start(req: RunRequest): AsyncIterable<RunEvent> {
    const redact = (s: string) => (req.runToken ? s.split(req.runToken).join('[token]') : s);
    const fail = (kind: ErrorKind, message: string): RunEvent => ({ type: 'error', kind, message: redact(message) });
    if (!o.apiKey) {
      yield fail('auth', 'The claude-agent runtime needs an Anthropic API key, and none is set. Add one to the server settings, or run this agent on a signed-in CLI instead.');
      return;
    }
    const query = o.query ?? (await loadAgentSdk());
    if (!query) {
      yield fail('config', 'The Claude Agent SDK is not installed on this server (npm package @anthropic-ai/claude-agent-sdk).');
      return;
    }
    const ctl = new AbortController();
    live.set(req.runId, ctl);
    const timeout = setTimeout(() => ctl.abort(new Error('timeout')), req.timeoutMs ?? 15 * 60_000);
    const standing = o.instructionsFor ? await o.instructionsFor(req).catch(() => '') : '';
    const model = o.modelFor?.(req);
    const options: Record<string, unknown> = {
      systemPrompt: [standing, req.instructions].filter(Boolean).join('\n\n'),
      mcpServers: { os: { type: 'http', url: o.osUrl, headers: { Authorization: `Bearer ${req.runToken}` } } },
      allowedTools: req.allowedTools ?? [],
      disallowedTools: req.deniedTools ?? [],
      permissionMode: 'dontAsk',
      settingSources: [],
      maxTurns: req.maxTurns,
      cwd: req.workDir ?? req.workspaceDir,
      // The SDK runs a process of its own: it gets what a program needs to start and the model's key, nothing from this server.
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? process.env.USERPROFILE ?? '', ANTHROPIC_API_KEY: o.apiKey, [RUN_TOKEN_ENV]: req.runToken },
      abortController: ctl,
      ...(model ? { model } : {}),
      ...(req.sessionId ? { resume: req.sessionId } : {}),
    };
    const parser = claudeParser();
    let ended = false;
    try {
      for await (const m of query({ prompt: req.taskInput, options })) {
        for (const e of parser.line(JSON.stringify(m))) {
          const clean = JSON.parse(redact(JSON.stringify(e))) as RunEvent;
          yield clean;
          if (e.type === 'done' || e.type === 'error') ended = true;
        }
        if (ended) break;
      }
      if (!ended && ctl.signal.aborted) throw new Error('aborted');
      if (!ended) for (const e of parser.end(0, '')) yield JSON.parse(redact(JSON.stringify(e))) as RunEvent;
    } catch (err) {
      if (cancelled.has(req.runId)) yield fail('cancelled', 'The run was cancelled.');
      else if (ctl.signal.aborted) yield fail('timeout', 'The run took too long and was stopped.');
      else yield fail('runtime', err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timeout);
      live.delete(req.runId);
      cancelled.delete(req.runId);
    }
  }

  return {
    name: 'claude-agent',
    canResume: true,
    start,
    async cancel(runId: string) {
      cancelled.add(runId);
      live.get(runId)?.abort(new Error('cancelled'));
    },
    async health(): Promise<RuntimeHealth> {
      return o.apiKey ? { ok: true, detail: 'An API key is set.' } : { ok: false, detail: 'No Anthropic API key is set.' };
    },
  };
}
