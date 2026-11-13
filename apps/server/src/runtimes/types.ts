import type { RuntimeName } from './names';

/** Why a run failed. `limit` and `auth` are their own kinds so the loop can pause instead of retrying (SPEC 7, 14). */
export type ErrorKind = 'runtime' | 'limit' | 'auth' | 'timeout' | 'max_turns' | 'cancelled' | 'config' | 'output_check' | 'silent';

/** Everything a runtime needs for one run (SPEC 7). No secrets except the run's own token. */
export interface RunRequest {
  runId: string;
  workspaceId: string;
  agentId: string;
  /** The agent's key, as in its role file. Used as the OpenCode agent name. */
  agentKey: string;
  taskId?: string;
  /** Per-run context: the task, its goal, matched lessons. Standing rules live in the rendered folder. */
  instructions: string;
  taskInput: string;
  /** The agent's rendered working folder (outside the repo). */
  workspaceDir: string;
  modelAlias: string;
  maxTurns: number;
  /** Short-lived token for the `os` MCP server, valid for this run only. */
  runToken: string;
  sessionId?: string;
  /** Default 15 minutes. */
  timeoutMs?: number;
  /** Claude Code tool names the run may use, from the template's permissions. */
  allowedTools?: string[];
  deniedTools?: string[];
}

export type RunEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'thinking' | 'message'; text: string }
  | { type: 'tool_call'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; ok: boolean; summary: string }
  | { type: 'cost'; usd: number; tokensIn: number; tokensOut: number }
  | { type: 'done'; output: string; sessionId?: string }
  | { type: 'error'; kind: ErrorKind; message: string };

export interface RuntimeHealth {
  ok: boolean;
  detail?: string;
}

export interface Runtime {
  name: RuntimeName;
  /** Yields events in order. Always ends with exactly one `done` or `error` event. */
  start(req: RunRequest): AsyncIterable<RunEvent>;
  cancel(runId: string): Promise<void>;
  health(): Promise<RuntimeHealth>;
  /** Whether `sessionId` on a request resumes a session (conformance point 7). */
  readonly canResume: boolean;
}

/** Env var that carries the run token to the agent's MCP config, so the token is never written to disk. */
export const RUN_TOKEN_ENV = 'CONCLAVE_RUN_TOKEN';
