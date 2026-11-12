import { z } from 'zod';
import type { RunScope } from './run-tokens';

/** What the `os` tools read and write. The database store implements this; tests use the memory store. */
export interface OsStore {
  /** The calling agent's autonomy level (SPEC 6). Tools with a higher `minAutonomy` are hidden and refused. */
  autonomy(scope: RunScope): Promise<number>;
  getTask(scope: RunScope): Promise<TaskView | null>;
  getLead(scope: RunScope, leadId: string): Promise<LeadView | null>;
  /** Adds a lead to the list (autonomy 1). Never marks it verified without a source. */
  addLead(scope: RunScope, input: AddLeadInput): Promise<{ id: string; existed: boolean; by?: 'email' | 'website'; verified: boolean }>;
  /** Records a 0 to 100 score and its reason on a lead (autonomy 1). */
  scoreLead(scope: RunScope, input: { leadId: string; score: number; reason: string }): Promise<void>;
  /** A deal with the figures a draft may quote (autonomy 0). Null if there is no such deal. */
  getDeal(scope: RunScope, dealId: string): Promise<DealView | null>;
  /** Keeps a draft document as a labelled comment on the task, after checking its figures (autonomy 1). */
  saveDraft(scope: RunScope, d: { dealId: string; kind: DraftKind; text: string }): Promise<void>;
  /** The latest morning brief, or null if there is none yet (autonomy 0: reading is for everyone). */
  getBrief(scope: RunScope): Promise<BriefView | null>;
  /** Sets the agent's paragraph on today's brief, building the brief first if needed (autonomy 1). */
  addBriefNote(scope: RunScope, text: string): Promise<{ day: string }>;
  /** Queues an email for approval. Never sends. Returns the approval id and whether it already existed. */
  proposeEmail(scope: RunScope, p: ProposedEmail): Promise<{ approvalId: string; existed: boolean }>;
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

export interface LeadView {
  id: string;
  businessName: string | null;
  website: string | null;
  contactName: string | null;
  email: string | null;
  stage: string;
  notes: string | null;
}

export interface ProposedEmail {
  leadId: string;
  subject: string;
  body: string;
  step: number;
  campaignId?: string | undefined;
}

export const DRAFT_KINDS = ['free-offer', 'contract-of-success', 'outcome-note', 'proof-report'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export interface DealView {
  dealId: string;
  account: string;
  offer: string | null;
  stage: string;
  status: string;
  decisionMaker: string | null;
  due: string | null;
  metric: string | null;
  value: number | null;
  baselineValue: number | null;
  targetValue: number | null;
  outcomeValue: number | null;
  /** Every figure in the deal's own fields. A draft may state these and no others. */
  figures: number[];
}

export interface BriefView {
  day: string;
  quiet: boolean;
  summary: string[];
  narrative: string | null;
  content: unknown;
}

export interface AddLeadInput {
  businessName?: string | undefined;
  website?: string | undefined;
  contactName?: string | undefined;
  email?: string | undefined;
  notes?: string | undefined;
  sourceUrl?: string | undefined;
  market?: string | undefined;
}

export class ToolError extends Error {}

const NoInput = z.object({}).strict();
const LeadInput = z.object({ leadId: z.uuid() }).strict();
const EmailInput = z
  .object({
    leadId: z.uuid(),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(5000),
    step: z.number().int().min(1).max(10).default(1),
    /** The running campaign this email is part of. Optional: a one-off email has none. */
    campaignId: z.uuid().optional(),
  })
  .strict();
const WebAddress = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => /^https?:\/\//i.test(v) && URL.canParse(v), 'must be an http or https address');
const AddLeadInput = z
  .object({
    businessName: z.string().trim().min(1).max(200).optional(),
    website: WebAddress(300).optional(),
    contactName: z.string().trim().min(1).max(200).optional(),
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()).optional(),
    notes: z.string().trim().min(1).max(5000).optional(),
    /** The page where you found it. Without one the lead is stored but marked unverified. */
    sourceUrl: WebAddress(500).optional(),
    market: z.enum(['services', 'product', 'founder_network']).optional(),
  })
  .strict()
  .refine((v) => v.businessName || v.email || v.website, { message: 'give at least a business name, an email address or a website' });
const ScoreInput = z
  .object({ leadId: z.uuid(), score: z.number().int().min(0).max(100), reason: z.string().trim().min(1).max(1000) })
  .strict();
const Text = (name: string, max: number) => z.object({ [name]: z.string().min(1).max(max) }).strict();

/**
 * The `os` tools (SPEC 6, 8). Every handler acts only on the run's own workspace and task.
 * `minAutonomy` hides a tool from agents below that level (SPEC 6, autonomy levels).
 */
export const osTools = {
  get_task: {
    minAutonomy: 0,
    description: 'Read your current task: its title, body, status and comments so far.',
    input: NoInput,
    async run(store: OsStore, scope: RunScope) {
      const task = await store.getTask(scope);
      if (!task) throw new ToolError('This run has no task.');
      return JSON.stringify(task, null, 2);
    },
  },
  comment: {
    minAutonomy: 0,
    description: 'Add a progress note to your task thread.',
    input: Text('text', 8000),
    async run(store: OsStore, scope: RunScope, args: { text: string }) {
      await store.comment(scope, args.text);
      return 'Comment added.';
    },
  },
  complete_task: {
    minAutonomy: 0,
    description: 'Finish your task with its final answer. Call this once, when the work is done.',
    input: Text('output', 50_000),
    async run(store: OsStore, scope: RunScope, args: { output: string }) {
      await store.completeTask(scope, args.output);
      return 'Task marked done.';
    },
  },
  block_task: {
    minAutonomy: 0,
    description: 'Mark your task blocked, with the reason. Use when you cannot continue.',
    input: Text('reason', 4000),
    async run(store: OsStore, scope: RunScope, args: { reason: string }) {
      await store.blockTask(scope, args.reason);
      return 'Task marked blocked.';
    },
  },
  ask_founder: {
    minAutonomy: 0,
    description: 'Ask the founder one specific question. Your task is marked blocked until they answer.',
    input: Text('question', 2000),
    async run(store: OsStore, scope: RunScope, args: { question: string }) {
      await store.askFounder(scope, args.question);
      return 'Question sent to the founder. Stop work on this task now.';
    },
  },
  get_lead: {
    minAutonomy: 0,
    description: 'Read one lead: business, website, contact, email, stage and notes.',
    input: LeadInput,
    async run(store: OsStore, scope: RunScope, args: { leadId: string }) {
      const lead = await store.getLead(scope, args.leadId);
      if (!lead) throw new ToolError('No such lead.');
      return JSON.stringify(lead, null, 2);
    },
  },
  add_lead: {
    minAutonomy: 1,
    description:
      'Add one lead you found to the list. Give the page where you found it as sourceUrl: without it the lead is stored as unverified and cannot join a campaign. A lead that is already there (same email or website) is not added twice.',
    input: AddLeadInput,
    async run(store: OsStore, scope: RunScope, args: AddLeadInput) {
      const r = await store.addLead(scope, args);
      if (r.existed) return `That lead is already in the list as ${r.id} (same ${r.by}). Nothing was changed.`;
      return `Added lead ${r.id}, ${r.verified ? 'verified (it has a source)' : 'unverified (no source URL was given)'}.`;
    },
  },
  score_lead: {
    minAutonomy: 1,
    description: 'Record how good a fit a lead is: a whole number from 0 to 100 and the reason, in a sentence or two. A new score replaces the old one.',
    input: ScoreInput,
    async run(store: OsStore, scope: RunScope, args: { leadId: string; score: number; reason: string }) {
      await store.scoreLead(scope, args);
      return `Scored ${args.score} out of 100.`;
    },
  },
  get_deal: {
    minAutonomy: 0,
    description: 'Read one deal: the account, the offer, the stage and the numbers recorded for it (value, baseline, target, outcome). A draft may state these figures and no others.',
    input: z.object({ dealId: z.uuid() }).strict(),
    async run(store: OsStore, scope: RunScope, args: { dealId: string }) {
      const d = await store.getDeal(scope, args.dealId);
      if (!d) throw new ToolError('No such deal.');
      return JSON.stringify(d, null, 2);
    },
  },
  save_draft: {
    minAutonomy: 1,
    description:
      'Keep a draft document for a person to review: a free offer, a contract of success, an outcome note or a monthly proof report. It is saved as a comment on your task and nothing is sent. Every figure in it must be one that get_deal returned; a draft with any other figure is refused.',
    input: z.object({ dealId: z.uuid(), kind: z.enum(DRAFT_KINDS), text: z.string().trim().min(1).max(8000) }).strict(),
    async run(store: OsStore, scope: RunScope, args: { dealId: string; kind: DraftKind; text: string }) {
      await store.saveDraft(scope, args);
      return `Saved as a draft (${args.kind}) on your task for a person to review. Nothing has been sent.`;
    },
  },
  get_brief: {
    minAutonomy: 0,
    description: 'Read the latest morning brief: what happened, what needs the founder, and how the goals stand. All numbers are counted from the tables.',
    input: NoInput,
    async run(store: OsStore, scope: RunScope) {
      const b = await store.getBrief(scope);
      if (!b) throw new ToolError('There is no brief yet.');
      return JSON.stringify(b, null, 2);
    },
  },
  add_brief_note: {
    minAutonomy: 1,
    description: 'Add one short paragraph (up to 1,500 characters) to today\'s brief, in your own words. It is shown as yours, beside the counted numbers, and a new one replaces the old.',
    input: Text('text', 1500),
    async run(store: OsStore, scope: RunScope, args: { text: string }) {
      if (!args.text.trim()) throw new ToolError('The note is empty.');
      const r = await store.addBriefNote(scope, args.text.trim());
      return `Added to the brief for ${r.day}.`;
    },
  },
  propose_email: {
    minAutonomy: 2,
    description:
      'Queue an email to a lead for the founder to approve. It does NOT send. Plain text only; the company footer is added when it is sent. Call it once per lead and step, then move on.',
    input: EmailInput,
    async run(store: OsStore, scope: RunScope, args: ProposedEmail) {
      const r = await store.proposeEmail(scope, args);
      return r.existed
        ? `Already queued as ${r.approvalId}. Do not propose it again.`
        : `Queued for approval as ${r.approvalId}. Nothing has been sent. Do not retry; finish your task.`;
    },
  },
} as const;

export type OsToolName = keyof typeof osTools;

export async function callOsTool(store: OsStore, scope: RunScope, name: string, args: unknown): Promise<string> {
  const tool = (osTools as Record<string, (typeof osTools)[OsToolName]>)[name];
  if (!tool) throw new ToolError(`Unknown tool "${name}".`);
  if (tool.minAutonomy > (await store.autonomy(scope))) throw new ToolError(`Unknown tool "${name}".`);
  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) throw new ToolError(`Bad input for ${name}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  return (tool.run as (s: OsStore, sc: RunScope, a: unknown) => Promise<string>)(store, scope, parsed.data);
}

/** Memory store for tests and for running without a database. */
export class MemoryOsStore implements OsStore {
  tasks = new Map<string, { id: string; workspaceId: string; title: string; body: string | null; status: string; output?: string; blockedReason?: string }>();
  messages: { workspaceId: string; taskId?: string; from: string; to: string | null; body: string; at: string }[] = [];
  autonomyLevel = 0;

  async autonomy() {
    return this.autonomyLevel;
  }
  async getLead(): Promise<LeadView | null> {
    return null;
  }
  async proposeEmail(): Promise<{ approvalId: string; existed: boolean }> {
    throw new ToolError('Proposals need the database store.');
  }
  async addLead(): Promise<{ id: string; existed: boolean; by?: 'email' | 'website'; verified: boolean }> {
    throw new ToolError('Leads need the database store.');
  }
  async scoreLead(): Promise<void> {
    throw new ToolError('Leads need the database store.');
  }
  async getBrief(): Promise<BriefView | null> {
    return null;
  }
  async getDeal(): Promise<DealView | null> {
    return null;
  }
  async saveDraft(): Promise<void> {
    throw new ToolError('Drafts need the database store.');
  }
  async addBriefNote(): Promise<{ day: string }> {
    throw new ToolError('The brief needs the database store.');
  }

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
