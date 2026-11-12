import {
  Agent,
  MaxTurnsExceededError,
  MCPServerStreamableHttp,
  ModelBehaviorError,
  OpenAIChatCompletionsModel,
  Runner,
  setTracingDisabled,
  type RunStreamEvent,
} from '@openai/agents';
import OpenAI from 'openai';
import { modelNameFor, resolveModel } from '../config/models';
import { type ErrorKind, type RunEvent, type RunRequest, type Runtime } from './types';

/**
 * The `openai-agents` runtime (SPEC 7, slice 4): the OpenAI Agents SDK run in-process by one generic runner, for short jobs
 * with few tools (scouts, triage, classifying) on any OpenAI-compatible endpoint, such as a local Ollama.
 *
 * There is no per-agent code: the agent is built at run time from the rendered instructions and the model alias. It is handed
 * exactly two things from outside: its model endpoint and key (`baseUrl`, `apiKey`) and the `os` MCP server with the run's
 * token. It gets no shell, no files and no network of its own (rule 10), and nothing is read from `process.env`: the SDK's
 * own environment lookups (OPENAI_API_KEY and the like) are never reached because the client is built here.
 *
 * Tracing is switched off. The SDK's default would send run traces to OpenAI's servers, and a trace holds prompts and tool
 * output: that is data leaving the machine, which nothing in the OS may do on its own (rule 4).
 *
 * Resume: the SDK keeps no session between processes here, so this runtime says it cannot resume and the loop restarts the
 * task from its comment history (SPEC 5, the table).
 */
export interface OpenAIAgentsOptions {
  /** The os MCP endpoint, such as http://127.0.0.1:3100/mcp. The run token is sent to it as a bearer token. */
  osUrl: string;
  /** Overrides the alias's endpoint. Tests point it at a fake server; production reads the alias. */
  baseUrl?: string;
  /** The model's key, for a hosted endpoint. A local endpoint needs none. This is the only secret the runner is handed. */
  apiKey?: string;
}

setTracingDisabled(true);

const MCP_PREFIX = 'mcp__os__';

/** Maps a thrown error to the run's error kind (SPEC 14), with a message a person can act on. */
export function classifyError(err: unknown, baseUrl: string, timedOut: boolean, cancelled: boolean): { kind: ErrorKind; message: string } {
  if (cancelled) return { kind: 'cancelled', message: 'The run was cancelled.' };
  if (timedOut) return { kind: 'timeout', message: 'The run took too long and was stopped.' };
  if (err instanceof MaxTurnsExceededError) return { kind: 'max_turns', message: 'The agent used all its turns without finishing.' };
  const status = (err as { status?: number } | null)?.status;
  const text = err instanceof Error ? err.message : String(err);
  if (status === 429) return { kind: 'limit', message: `The model endpoint is rate limited (429). ${text}` };
  if (status === 401 || status === 403) return { kind: 'auth', message: `The model endpoint refused the key (${status}). ${text}` };
  if (status === 404) return { kind: 'config', message: `The model endpoint at ${baseUrl} has no such model or path (404). ${text}` };
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|Connection error/i.test(text) || (err as { code?: string } | null)?.code === 'ECONNREFUSED') {
    return { kind: 'runtime', message: `The model endpoint at ${baseUrl} cannot be reached. Is the local model server (for example Ollama) running? ${text}` };
  }
  return { kind: 'runtime', message: text };
}

function summarise(output: unknown): string {
  const s = typeof output === 'string' ? output : JSON.stringify(output);
  return (s ?? '').slice(0, 500);
}

export function createOpenAIAgentsRuntime(options: OpenAIAgentsOptions): Runtime {
  const controllers = new Map<string, AbortController>();
  const cancelled = new Set<string>();

  return {
    name: 'openai-agents',
    canResume: false,

    async *start(req: RunRequest): AsyncIterable<RunEvent> {
      const alias = resolveModel(req.modelAlias);
      const baseUrl = options.baseUrl ?? alias.baseUrl;
      const sessionId = `oa-${req.runId}`;
      yield { type: 'session', sessionId };
      if (!baseUrl) {
        yield { type: 'error', kind: 'config', message: `Model alias "${req.modelAlias}" has no endpoint, so the openai-agents runtime cannot reach a model.` };
        return;
      }

      const controller = new AbortController();
      controllers.set(req.runId, controller);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, req.timeoutMs ?? 15 * 60_000);

      // The os server over HTTP with this run's token. Only the tools the role is allowed are listed to the model.
      const allowed = req.allowedTools?.filter((t) => t.startsWith(MCP_PREFIX)).map((t) => t.slice(MCP_PREFIX.length));
      const mcp = new MCPServerStreamableHttp({
        url: options.osUrl,
        name: 'os',
        cacheToolsList: true,
        requestInit: { headers: { Authorization: `Bearer ${req.runToken}` } },
        ...(allowed?.length ? { toolFilter: { allowedToolNames: allowed } } : {}),
      });
      let lastTool = '';
      try {
        await mcp.connect();
        const client = new OpenAI({ baseURL: baseUrl, apiKey: options.apiKey ?? 'local', maxRetries: 0 });
        const agent = new Agent({
          name: req.agentKey,
          instructions: req.instructions,
          model: new OpenAIChatCompletionsModel(client, modelNameFor(req.modelAlias, 'openai-agents')),
          mcpServers: [mcp],
        });
        const runner = new Runner({ tracingDisabled: true });
        const result = await runner.run(agent, req.taskInput, { stream: true, maxTurns: req.maxTurns, signal: controller.signal });
        for await (const event of result as AsyncIterable<RunStreamEvent>) {
          if (event.type !== 'run_item_stream_event') continue;
          const raw = (event.item as { rawItem?: Record<string, unknown>; output?: unknown }).rawItem ?? {};
          if (event.name === 'tool_called') {
            lastTool = String(raw.name ?? '');
            let input: unknown = raw.arguments;
            try {
              input = JSON.parse(String(raw.arguments ?? '{}'));
            } catch {
              // keep the raw text
            }
            yield { type: 'tool_call', tool: lastTool, input };
          } else if (event.name === 'tool_output') {
            const out = (event.item as { output?: unknown }).output;
            const failed = /^(error|an error occurred)/i.test(typeof out === 'string' ? out : '') || (raw as { status?: string }).status === 'incomplete';
            yield { type: 'tool_result', tool: String(raw.name ?? lastTool), ok: !failed, summary: summarise(out) };
          } else if (event.name === 'message_output_created') {
            const content = raw.content as { type?: string; text?: string }[] | undefined;
            const text = content?.map((c) => c.text ?? '').join('') ?? '';
            if (text) yield { type: 'message', text };
          }
        }
        await result.completed;
        const usage = (result as { state?: { usage?: { inputTokens?: number; outputTokens?: number } } }).state?.usage;
        yield { type: 'cost', usd: 0, tokensIn: usage?.inputTokens ?? 0, tokensOut: usage?.outputTokens ?? 0 };
        yield { type: 'done', output: String(result.finalOutput ?? ''), sessionId };
      } catch (err) {
        // A tool the model named that was not granted is refused by the SDK before any call is made. Show it as a refused tool.
        if (err instanceof ModelBehaviorError && /not found/i.test(err.message)) {
          yield { type: 'tool_result', tool: lastTool || 'unknown', ok: false, summary: err.message.slice(0, 500) };
        }
        const { kind, message } = classifyError(err, baseUrl, timedOut, cancelled.has(req.runId) || (controller.signal.aborted && !timedOut));
        yield { type: 'error', kind, message };
      } finally {
        clearTimeout(timer);
        controllers.delete(req.runId);
        cancelled.delete(req.runId);
        await mcp.close().catch(() => undefined);
      }
    },

    async cancel(runId: string) {
      cancelled.add(runId);
      controllers.get(runId)?.abort();
    },

    async health() {
      const baseUrl = options.baseUrl ?? resolveModel('local-worker').baseUrl;
      if (!baseUrl) return { ok: false, detail: 'no endpoint configured' };
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(2000), headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {} });
        return res.ok ? { ok: true } : { ok: false, detail: `${baseUrl} answered ${res.status}` };
      } catch (err) {
        return { ok: false, detail: `${baseUrl} cannot be reached: ${(err as Error).message}` };
      }
    },
  };
}
