import { Hono } from 'hono';
import type { AppEnv } from '../app';

/**
 * Boards (jsm-hq's plan wall and boards modal): one board per goal, its tasks grouped by where they are, and one for tasks with no goal. Read only:
 * goals come from `goals.yaml`, and a task's status changes through the run loop and the approvals, not from here. (jsm-hq lets agents pick only
 * from active boards; ours do not look at a goal's status when they take a task, so the screen shows the status and does not offer to change it.)
 */
export function boardRoutes() {
  const r = new Hono<AppEnv>();
  r.get('/', async (c) => {
    const tx = c.get('tx').client;
    const goals = (await tx.query<{ id: string; key: string; title: string; kind: string; status: string }>("select id, key, title, kind, status from goals where status <> 'retired' order by kind, key")).rows;
    const tasks = (await tx.query<{ id: string; title: string; status: string; priority: number; goal_id: string | null; assignee: string | null }>(
      "select t.id, t.title, t.status, t.priority, t.goal_id, a.key as assignee from tasks t left join agents a on a.id = t.assignee_id where t.status <> 'cancelled' order by t.priority, t.created_at desc limit 1000",
    )).rows;
    const shape = (t: (typeof tasks)[number]) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, assignee: t.assignee });
    return c.json({
      boards: [
        ...goals.map((g) => ({ id: g.id as string | null, key: g.key, title: g.title, kind: g.kind, status: g.status, tasks: tasks.filter((t) => t.goal_id === g.id).map(shape) })),
        { id: null as string | null, key: 'no-goal', title: 'No goal', kind: 'none', status: 'active', tasks: tasks.filter((t) => !t.goal_id).map(shape) },
      ],
    });
  });
  return r;
}
