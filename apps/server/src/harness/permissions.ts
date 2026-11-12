import { z } from 'zod';

const Effect = z.enum(['allow', 'deny']);

/** Neutral permission rules kept once per template (SPEC 5, the portability rule). */
export const PermissionsSchema = z
  .object({
    read: Effect.default('allow'),
    write: Effect.default('allow'),
    shell: Effect.default('deny'),
    web_search: Effect.default('deny'),
    web_fetch: Effect.default('deny'),
    subagents: Effect.default('deny'),
  })
  .strict();
export type Permissions = z.infer<typeof PermissionsSchema>;

/** Templates allowed a shell (CLAUDE.md rule 10). Only these may set `shell: allow`. */
export const SHELL_TEMPLATES = new Set(['coder', 'code-reviewer']);

const claudeTools: Record<keyof Permissions, string[]> = {
  read: ['Read', 'Glob', 'Grep'],
  write: ['Write', 'Edit', 'NotebookEdit'],
  shell: ['Bash'],
  web_search: ['WebSearch'],
  web_fetch: ['WebFetch'],
  subagents: ['Task', 'Agent'],
};

/** Claude Code tool names allowed and denied for a permission set. MCP tools from `os` are always allowed. */
export function claudeToolLists(p: Permissions): { allow: string[]; deny: string[] } {
  const allow: string[] = [];
  const deny: string[] = [];
  for (const [k, tools] of Object.entries(claudeTools) as [keyof Permissions, string[]][]) {
    (p[k] === 'allow' ? allow : deny).push(...tools);
  }
  allow.push('mcp__os');
  return { allow, deny };
}

/** OpenCode `permission` map (opencode 1.19 shape: tool key to action). */
export function opencodePermission(p: Permissions): Record<string, string> {
  return {
    read: p.read,
    glob: p.read,
    grep: p.read,
    list: p.read,
    edit: p.write,
    bash: p.shell,
    websearch: p.web_search,
    webfetch: p.web_fetch,
    task: p.subagents,
    external_directory: 'deny',
    skill: 'allow',
    question: 'deny',
  };
}
