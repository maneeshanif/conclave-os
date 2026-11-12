import { z } from 'zod';
import type { RunScope } from './run-tokens';

/** What the `os` tools read and write. The database store implements this; tests use the memory store. */
export interface OsStore {
  getTask(scope: RunScope): Promise<TaskView | null>;
  comment(scope: RunScope, text: string): Promise<void>;
  completeTask(scope: RunScope, output: string): Promise<void>;
  blockTask(scope: RunScope, reason: string): Promise<void>;
  askFounder(scope: RunScope, question: string): Promise<void>;
}

export interface TaskView {
  id: string;
  title: string;
  body: string | null;
  status: string;
  comments: { from: string; body: string; at: string }[];
}

export class ToolError extends Error {}

const NoInput = z.object({}).strict();
const Text = (name: string, max: number) => z.object({ [name]: z.string().min(1).max(max) }).strict();

/** The five slice 0 tools (SPEC 6, 8). Every handler acts only on the run's own task. */
export const osTools = {
  get_task: {
    description: 'Read your current task: its title, body, status and comments so far.',
    input: NoInput,
    async run(store: OsStore, scope: RunScope) {
      const task = await store.getTask(scope);
      if (!task) throw new ToolError('This run has no task.');
      return JSON.stringify(task, null, 2);
    },
  },
  comment: {
    description: 'Add a progress note to your task thread.',
    input: Text('text', 8000),
    async run(store: OsStore, scope: RunScope, args: { text: string }) {
      await store.comment(scope, args.text);
      return 'Comment added.';
    },
  },
  complete_task: {
    description: 'Finish your task with its final answer. Call this once, when the work is done.',
    input: Text('output', 50_000),
    async run(store: OsStore, scope: RunScope, args: { output: string }) {
      await store.completeTask(scope, args.output);
      return 'Task marked done.';
    },
  },
  block_task: {
    description: 'Mark your task blocked, with the reason. Use when you cannot continue.',
    input: Text('reason', 4000),
    async run(store: OsStore, scope: RunScope, args: { reason: string }) {
      await store.blockTask(scope, args.reason);
      return 'Task marked blocked.';
    },
  },
  ask_founder: {
    description: 'Ask the founder one specific question. Your task is marked blocked until they answer.',
    input: Text('question', 2000),
    async run(store: OsStore, scope: RunScope, args: { question: string }) {
      await store.askFounder(scope, args.question);
      return 'Question sent to the founder. Stop work on this task now.';
    },
  },
} as const;

export type OsToolName = keyof typeof osTools;

export async function callOsTool(store: OsStore, scope: RunScope, name: string, args: unknown): Promise<string> {
  const tool = (osTools as Record<string, (typeof osTools)[OsToolName]>)[name];
  if (!tool) throw new ToolError(`Unknown tool "${name}".`);
  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) throw new ToolError(`Bad input for ${name}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  return (tool.run as (s: OsStore, sc: RunScope, a: unknown) => Promise<string>)(store, scope, parsed.data);
}

/** Memory store for tests and for running without a database. */
export class MemoryOsStore implements OsStore {
  tasks = new Map<string, { id: string; workspaceId: string; title: string; body: string | null; status: string; output?: string; blockedReason?: string }>();
  messages: { workspaceId: string; taskId?: string; from: string; to: string | null; body: string; at: string }[] = [];

  private task(scope: RunScope) {
    const t = scope.taskId ? this.tasks.get(scope.taskId) : undefined;
    if (!t || t.workspaceId !== scope.workspaceId) throw new ToolError('This run has no task.');
    return t;
  }
  async getTask(scope: RunScope): Promise<TaskView | null> {
    const t = scope.taskId ? this.tasks.get(scope.taskId) : undefined;
    if (!t || t.workspaceId !== scope.workspaceId) return null;
    return {
      id: t.id,
      title: t.title,
      body: t.body,
      status: t.status,
      comments: this.messages.filter((m) => m.taskId === t.id).map((m) => ({ from: m.from, body: m.body, at: m.at })),
    };
  }
  async comment(scope: RunScope, text: string) {
    const t = this.task(scope);
    this.messages.push({ workspaceId: t.workspaceId, taskId: t.id, from: `agent:${scope.agentId}`, to: null, body: text, at: new Date().toISOString() });
  }
  async completeTask(scope: RunScope, output: string) {
    const t = this.task(scope);
    t.status = 'done';
    t.output = output;
    await this.comment(scope, output);
  }
  async blockTask(scope: RunScope, reason: string) {
    const t = this.task(scope);
    t.status = 'blocked';
    t.blockedReason = reason;
  }
  async askFounder(scope: RunScope, question: string) {
    const t = this.task(scope);
    this.messages.push({ workspaceId: t.workspaceId, taskId: t.id, from: `agent:${scope.agentId}`, to: 'founder', body: question, at: new Date().toISOString() });
    t.status = 'blocked';
    t.blockedReason = `Waiting for the founder: ${question}`;
  }
}
