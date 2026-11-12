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
  actionItems: () => call<ActionItem[]>('/api/action-items'),
  resolve: (id: string, note?: string) => call<{ id: string; status: string }>(`/api/action-items/${id}/resolve`, { method: 'POST', body: JSON.stringify(note ? { note } : {}) }),
  decide: (id: string, body: DecisionBody) => call<{ id: string; status: string }>(`/api/approvals/${id}/decide`, { method: 'POST', body: JSON.stringify(body) }),
};
