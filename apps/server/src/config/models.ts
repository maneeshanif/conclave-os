import { RUNTIMES, type RuntimeName } from '../runtimes/names';

/**
 * Model aliases (SPEC 7). Role files name an alias, never a model.
 * `on` lists the runtimes an alias works on; the loader rejects a role file
 * whose alias does not list its runtime.
 *
 * Values here are defaults for a fresh install. A workspace can override them
 * later from Settings; until then this file is the only place a model is named
 * (CLAUDE.md rule 11).
 */
export interface ModelAlias {
  /** The model name passed to the runtime. Empty means "the runtime's own default". */
  name: string;
  on: readonly RuntimeName[];
  /** A different model name for one runtime, e.g. OpenCode wants `provider/model`. */
  perRuntime?: Partial<Record<RuntimeName, string>>;
  /** OpenAI-compatible base URL, for local or self-hosted models. */
  baseUrl?: string;
  /** Extra environment variables the runtime may pass to the agent process. Never secrets. */
  env?: Readonly<Record<string, string>>;
}

export const models: Readonly<Record<string, ModelAlias>> = {
  writer: { name: '', on: ['claude-cli', 'claude-agent'] },
  'strong-writer': { name: 'opus', on: ['claude-cli', 'claude-agent'] },
  researcher: { name: 'sonnet', on: ['claude-cli', 'claude-agent'] },
  'any-model': { name: '', on: ['opencode'] },
  'local-worker': {
    name: 'qwen3:8b',
    on: ['openai-agents', 'opencode'],
    perRuntime: { opencode: 'ollama/qwen3:8b' },
    baseUrl: 'http://127.0.0.1:11434/v1',
  },
};

export function resolveModel(alias: string): ModelAlias {
  const model = models[alias];
  if (!model) throw new Error(`Unknown model alias "${alias}". Known: ${Object.keys(models).join(', ')}`);
  return model;
}

/** The model name to hand a runtime for this alias. Empty means "use the runtime's default". */
export function modelNameFor(alias: string, runtime: RuntimeName): string {
  const m = resolveModel(alias);
  return m.perRuntime?.[runtime] ?? m.name;
}

export function aliasWorksOn(alias: string, runtime: string): boolean {
  const model = models[alias];
  return !!model && (model.on as readonly string[]).includes(runtime);
}

export { RUNTIMES };
