/**
 * The panels that open over the office (SPEC 12). The office is the whole app: every page that used to be its own route is a
 * panel now, and the open one is kept in the address (`/?panel=approvals`) so it can be linked to and survives a reload.
 * Pure: it only turns ids and addresses into each other.
 */
export const PANEL_IDS = ['tasks', 'approvals', 'needs-you', 'brief', 'inbox', 'pipeline', 'campaigns', 'goals', 'signals', 'ideas', 'health', 'run-log', 'department-board', 'department-meeting', 'boardroom', 'rooms', 'deployments', 'talent', 'meetings', 'channels', 'network', 'settings', 'pulls'] as const;
export type PanelId = (typeof PANEL_IDS)[number];

export const PANEL_LABELS: Record<PanelId, string> = {
  tasks: 'Tasks',
  approvals: 'Approvals',
  'needs-you': 'Needs you',
  brief: 'Brief',
  inbox: 'Inbox',
  pipeline: 'Pipeline',
  campaigns: 'Campaigns',
  goals: 'Goals',
  signals: 'Signals',
  ideas: 'Ideas',
  health: 'Health',
  'run-log': 'Run log',
  'department-board': 'Department board',
  'department-meeting': 'Department channel',
  boardroom: 'Boardroom',
  rooms: 'Rooms and agents',
  deployments: 'Deployments',
  talent: 'Talent room',
  meetings: 'Client meetings',
  channels: 'Client messages',
  network: 'Founder Network',
  settings: 'Settings',
  pulls: 'Pull requests',
};

export interface PanelState {
  id: PanelId;
  /** Only the run log takes one: the task whose runs to show. */
  task?: string;
  /** Only a department board or channel takes one: the department's key. */
  dept?: string;
  /** Only the list of rooms and agents takes one: the agent whose drawer is open. */
  agent?: string;
}

const WITH_DEPT = ['department-board', 'department-meeting'] as const;
const DEPT = /^[a-z0-9][a-z0-9-]{0,60}$/;

/** The old routes, which now only lead to the office with the matching panel open. */
export const LEGACY_ROUTES: Record<string, PanelId> = {
  '/approvals': 'approvals',
  '/action-items': 'needs-you',
  '/brief': 'brief',
  '/inbox': 'inbox',
  '/pipeline': 'pipeline',
  '/campaigns': 'campaigns',
  '/goals': 'goals',
  '/signals': 'signals',
  '/ideas': 'ideas',
  '/health': 'health',
};

const TASK = /^[0-9a-f-]{36}$/i;
const known = (v: string | null): v is PanelId => v !== null && (PANEL_IDS as readonly string[]).includes(v);

/** The address that opens a panel over the office. `base` is the page the office is on ('/' once it is the home page). */
export function panelHref(p: PanelId | PanelState, base = '/'): string {
  const s: PanelState = typeof p === 'string' ? { id: p } : p;
  if (s.id === 'run-log' && s.task) return `${base}?panel=run-log&task=${s.task}`;
  if (s.id === 'rooms' && s.agent) return `${base}?panel=rooms&agent=${s.agent}`;
  if ((WITH_DEPT as readonly string[]).includes(s.id) && s.dept) return `${base}?panel=${s.id}&dept=${s.dept}`;
  return `${base}?panel=${s.id}`;
}

/** The panel an address asks for. Null for nothing, an unknown name, or a run log with no usable task. */
export function parsePanel(search: string | URLSearchParams): PanelState | null {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const id = q.get('panel');
  if (!known(id)) return null;
  if (id === 'run-log') {
    const task = q.get('task');
    return task && TASK.test(task) ? { id, task } : null;
  }
  if (id === 'rooms') {
    const agent = q.get('agent');
    return agent && TASK.test(agent) ? { id, agent } : { id };
  }
  if ((WITH_DEPT as readonly string[]).includes(id)) {
    const dept = q.get('dept');
    return dept && DEPT.test(dept) ? { id, dept } : null;
  }
  return { id };
}
