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
  /** A base URL that is not on this machine is refused unless this is set: a model endpoint off the machine sees every prompt. */
  allowRemote?: boolean;
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

/** What is wrong with a set of aliases, one sentence each; empty when all is well. Checked by the tests so a bad edit here cannot ship. */
export function validateAliases(all: Readonly<Record<string, ModelAlias>>): string[] {
  const problems: string[] = [];
  for (const [alias, m] of Object.entries(all)) {
    if (m.on.length === 0) problems.push(`Alias "${alias}" lists no runtime.`);
    for (const r of m.on) if (!(RUNTIMES as readonly string[]).includes(r)) problems.push(`Alias "${alias}" lists an unknown runtime "${r}".`);
    if (m.baseUrl === undefined) continue;
    let url: URL;
    try {
      url = new URL(m.baseUrl);
    } catch {
      problems.push(`Alias "${alias}" has a base URL that is not a valid URL: ${m.baseUrl}`);
      continue;
    }
    if (url.username || url.password) problems.push(`Alias "${alias}" has credentials in its base URL; keys go in the secrets store, never in a URL.`);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (!local && !m.allowRemote) problems.push(`Alias "${alias}" points at ${url.hostname}, which is not on this machine. Set allowRemote on the alias if that is meant.`);
  }
  return problems;
}

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
