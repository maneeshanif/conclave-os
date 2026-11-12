/** Every runtime name the spec knows (SPEC 7). Which ones are built depends on the slice. */
export const RUNTIMES = ['claude-cli', 'opencode', 'openai-agents', 'codex', 'http', 'claude-agent'] as const;
export type RuntimeName = (typeof RUNTIMES)[number];

/** Runtimes that exist in this build. Slice 0 builds the two CLI runtimes; slice 4 adds the in-process openai-agents runner. */
export const BUILT_RUNTIMES: readonly RuntimeName[] = ['claude-cli', 'opencode', 'openai-agents'];
