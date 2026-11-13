/** The server answers on 127.0.0.1:3100 by default (CLAUDE.md rule 9). */
export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3100';

export interface Agent {
  id: string;
  key: string;
  name: string;
  status: string;
  runtime: string;
  model_alias: string;
  department: string | null;
  last_run_status: string | null;
}

export interface Task {
  id: string;
  title: string;
  body: string | null;
  status: string;
  blocked_reason: string | null;
  assignee_key: string | null;
  assignee_name: string | null;
  last_run_id: string | null;
  created_at: string;
}

export type RunEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'thinking' | 'message'; text: string }
  | { type: 'tool_call'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; ok: boolean; summary: string }
  | { type: 'cost'; usd: number; tokensIn: number; tokensOut: number }
  | { type: 'done'; output: string; sessionId?: string }
  | { type: 'error'; kind: string; message: string };

export interface StoredEvent {
  id: number | string;
  at?: string;
  type: string;
  data: RunEvent;
}

export interface Run {
  id: string;
  status: string;
  runtime: string;
  model: string | null;
  trigger: string;
  cost_usd: string | number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  error: string | null;
  started_at: string | null;
  ended_at: string | null;
}

export interface TaskDetail {
  task: Task;
  thread: { id: string; from_id: string; to_id: string | null; body: string; created_at: string }[];
  runs: Run[];
}

/** One thing waiting for a decision (SPEC 6). `lead` comes with an email so the card can show what it rests on. */
export interface Approval {
  id: string;
  kind: string;
  status: string;
  agent_id: string | null;
  agent_key: string | null;
  task_id: string | null;
  payload: Record<string, unknown>;
  edited_payload: Record<string, unknown> | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  result: unknown;
  created_at: string;
  lead?: { id: string; business_name: string | null; website: string | null; email: string | null; stage: string; notes: string | null } | null;
}

/** Something that needs the founder. `derived` ones come from live state and clear themselves. */
export interface ActionItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  status: string;
  task_id: string | null;
  approval_id: string | null;
  created_at: string | null;
  derived?: boolean;
}

/** The goals screen's data (S2-9). Progress is measured from the tables; null means it is not measured. */
export interface GoalProgress {
  target: number | null;
  unit: string | null;
  window: string | null;
  measured: boolean;
  current: number | null;
  pct: number | null;
}
export interface RungGoal extends GoalProgress {
  key: string;
  title: string | null;
  due: string | null;
  status: string;
  source: string | null;
  met: boolean;
}
export interface DepartmentGoal extends GoalProgress {
  key: string;
  department: string | null;
  metric: string | null;
  serves: string | null;
  stage: string | null;
}
export interface GoalsData {
  current_rung: string | null;
  rungs: RungGoal[];
  departments: DepartmentGoal[];
}

/** The morning brief (S2-10): counted from the tables; the narrative is the chief of staff agent's own paragraph. */
export interface HealthOverview {
  generatedAt: string;
  windowHours: number;
  killSwitch: { on: boolean; at: string | null };
  queue: { todo: number; in_progress: number; blocked: number };
  agents: { id: string; key: string; name: string; runs: number; failed: number; failureRate: number | null; spentThisMonth: number; budget: number; overBudget: boolean }[];
  breakers: { key: string; failures: number; lastError: string | null; openedAt: string | null; openUntil: string | null }[];
  pauses: { runtime: string; label: string; until: string; reason: string }[];
  reaper: { at: string; reaped: number; requeued: number; blocked: number } | null;
  database: { sizeBytes: number };
  reroutes: { agent: string; from: string; to: string; reason: string; at: string }[];
}

export interface Brief {
  day: string;
  quiet: boolean;
  summary: string[];
  narrative: string | null;
  narrative_by: string | null;
  created_at: string;
  updated_at: string;
  content: {
    leads: { new: number; scored: number; qualified: number; top: { id: string; name: string | null; score: number; reason: string | null }[] };
    approvals: { waiting: number; oldest_hours: number | null; items: { id: string; kind: string; label: string; created_at: string }[] };
    replies: { to_triage: number; items: { task_id: string; title: string }[] };
    deals: { stuck: number; items: { deal_id: string; account: string; stage: string; days: number }[] };
    attention: { blocked: { task_id: string; title: string; reason: string | null }[]; action_items: { id: string; kind: string; title: string }[]; kill_switch: boolean };
    sent: { emails_24h: number };
    goals: { current_rung: string | null; rungs: { key: string; title: string | null; target: number | null; current: number | null; pct: number | null; met: boolean }[]; departments: unknown[] };
  };
}

/** Inbox (S2-11): one thread per lead. Reply text is data from outside and is only ever shown as text. */
export interface ThreadSummary {
  id: string;
  status: string;
  last_message_at: string | null;
  lead_id: string | null;
  lead_name: string | null;
  lead_email: string | null;
  lead_stage: string | null;
  messages: number;
  last_body: string | null;
  last_direction: 'in' | 'out' | null;
}
export interface ThreadMessage {
  id: string;
  direction: 'in' | 'out';
  channel: string;
  subject: string | null;
  body: string;
  campaign_id: string | null;
  classification: 'positive' | 'neutral' | 'negative' | null;
  at: string;
}
export interface ThreadDetail extends Omit<ThreadSummary, 'messages' | 'last_body' | 'last_direction'> {
  messages: ThreadMessage[];
}

/** Pipeline (S2-11): conversion and days by stage for one funnel. */
export interface PipelineStage {
  key: string;
  name: string;
  position: number;
  owner: string | null;
  current: number;
  reached: number;
  conversion: number | null;
  avg_days: number | null;
  median_days: number | null;
}
export interface PipelineData {
  funnel: string;
  name: string;
  stages: PipelineStage[];
  totals: { open: number; won: number; lost: number };
  stuck: { deal_id: string; account: string; stage: string; days_in_stage: number; missing: string[] }[];
  stuck_after_days: number;
}

/** Campaigns (S2-11). */
export interface CampaignRow {
  id: string;
  name: string;
  market: string | null;
  channel: string;
  status: 'draft' | 'approved' | 'running' | 'paused' | 'done';
  channel_account_id: string | null;
  channel_handle: string | null;
  approved_at: string | null;
  steps: number;
}
export interface CampaignResults {
  campaign: string;
  name: string;
  status: string;
  enrolled: number;
  enrollment: { active: number; paused: number; unsubscribed: number; done: number };
  sent: number;
  delivered: number | null;
  opened: number | null;
  replied: number;
  positive_replies: number;
  reply_rate: number | null;
  meetings: number | null;
  won: number;
  cost_usd: number;
}
export type CampaignAction = 'approve' | 'start' | 'pause' | 'finish';

/** What the person decided. An edit carries only the text that may change on an email: the subject and the message. */
export interface DecisionBody {
  approved: boolean;
  note?: string;
  editedPayload?: { subject: string; body: string };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { credentials: 'include', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401 && typeof window !== 'undefined' && window.location.pathname !== '/login') window.location.assign('/login');
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export const api = {
  agents: () => call<Agent[]>('/api/agents'),
  tasks: () => call<Task[]>('/api/tasks'),
  task: (id: string) => call<TaskDetail>(`/api/tasks/${id}`),
  run: (id: string) => call<{ run: Run; events: StoredEvent[] }>(`/api/runs/${id}`),
  createTask: (t: { title: string; body?: string; assigneeId?: string }) => call<{ id: string }>('/api/tasks', { method: 'POST', body: JSON.stringify(t) }),
  retry: (id: string) => call<{ ok: true }>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'todo' }) }),
  runAgent: (id: string) => call<{ requested: true }>(`/api/agents/${id}/run`, { method: 'POST' }),
  approvals: (status?: string) => call<Approval[]>(`/api/approvals${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  goals: () => call<GoalsData>('/api/goals'),
  threads: () => call<ThreadSummary[]>('/api/threads'),
  thread: (id: string) => call<ThreadDetail>(`/api/threads/${id}`),
  recordReply: (threadId: string, body: string) => call<{ messageId: string }>(`/api/threads/${threadId}/inbound`, { method: 'POST', body: JSON.stringify({ body }) }),
  classify: (messageId: string, classification: 'positive' | 'neutral' | 'negative') =>
    call<{ id: string }>(`/api/thread-messages/${messageId}/classify`, { method: 'POST', body: JSON.stringify({ classification }) }),
  pipeline: () => call<PipelineData[]>('/api/pipeline'),
  campaigns: () => call<CampaignRow[]>('/api/campaigns'),
  campaignResults: (id: string) => call<CampaignResults>(`/api/campaigns/${id}/results`),
  campaignAction: (id: string, action: CampaignAction) => call<{ id: string; status: string }>(`/api/campaigns/${id}/${action}`, { method: 'POST', body: '{}' }),
  brief: async (): Promise<Brief | null> => {
    try {
      return await call<Brief>('/api/brief');
    } catch (err) {
      if ((err as Error).message.startsWith('There is no brief')) return null;
      throw err;
    }
  },
  rebuildBrief: () => call<Brief>('/api/brief/rebuild', { method: 'POST', body: '{}' }),
  health: () => call<HealthOverview>('/api/health/overview'),
  setKillSwitch: async (on: boolean) => {
    await call('/api/settings', { method: 'PATCH', body: JSON.stringify({ killSwitch: on }) });
  },
  resetBreaker: async (key: string) => {
    await call(`/api/breakers/${encodeURIComponent(key)}/reset`, { method: 'POST', body: '{}' });
  },
  liftPause: async (runtime: string) => {
    await call(`/api/runtime-pauses/${encodeURIComponent(runtime)}/lift`, { method: 'POST', body: '{}' });
  },
  actionItems: () => call<ActionItem[]>('/api/action-items'),
  resolve: (id: string, note?: string) => call<{ id: string; status: string }>(`/api/action-items/${id}/resolve`, { method: 'POST', body: JSON.stringify(note ? { note } : {}) }),
  decide: (id: string, body: DecisionBody) => call<{ id: string; status: string }>(`/api/approvals/${id}/decide`, { method: 'POST', body: JSON.stringify(body) }),
};
