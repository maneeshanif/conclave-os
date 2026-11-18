import type pg from 'pg';
import { withWorkspace } from '../db/tenant';
import { keywords } from '../memory/memory';

/**
 * The weekly gap check (S8-9, SPEC 9). A gap is work no active role covers. It needs two of three signals: (1) no active agent covers it
 * (the task has no assignee, or its assignee is not active), (2) it keeps coming and is not shrinking (as many this week as last, at least
 * two), (3) when someone did attempt it, it came back wrong (a task of the cluster is blocked). Work is grouped by the word most of its task
 * titles share. A confirmed gap then gets one of four forks; a standing agent is a standing cost, so a gap is not automatically a hire.
 */
export type Fork = 'hire' | 'escalate' | 'queue' | 'decline';

export interface Gap {
  topic: string;
  /** Up to three task titles from the cluster, so a person can see what it is about. */
  examples: string[];
  tasks: number;
  thisWeek: number;
  lastWeek: number;
  signals: { uncovered: boolean; growing: boolean; failing: boolean };
  confirmed: boolean;
  fork: Fork | null;
  why: string;
}

/** The fork for a confirmed gap: hire what is durable and high-volume, escalate what is rare and went wrong, queue what is small, decline what is a single signal. */
export function chooseFork(g: Pick<Gap, 'tasks' | 'thisWeek' | 'lastWeek' | 'signals' | 'confirmed'>): { fork: Fork; why: string } {
  if (!g.confirmed) return { fork: 'decline', why: 'fewer than two signals: not a gap yet' };
  if (g.signals.growing && g.thisWeek >= 3) return { fork: 'hire', why: `${g.thisWeek} this week against ${g.lastWeek} last week, and nobody covers it` };
  if (g.signals.failing && !g.signals.growing) return { fork: 'escalate', why: 'it is rare, and when it was attempted it went wrong: a person should decide it' };
  return { fork: 'queue', why: 'it is real but small or bursty: keep it in line' };
}

export async function gapCheck(pool: pg.Pool, workspaceId: string, now: Date = new Date()): Promise<Gap[]> {
  const day = 86_400_000;
  const rows = (
    await withWorkspace(pool, workspaceId, ({ client: c }) =>
      c.query<{ title: string; status: string; created_at: Date }>(
        `select t.title, t.status, t.created_at from tasks t left join agents a on a.id = t.assignee_id and a.workspace_id = t.workspace_id
          where t.created_at >= $1 and t.created_at < $2 and t.status not in ('done','cancelled') and (t.assignee_id is null or a.status <> 'active')`,
        [new Date(now.getTime() - 14 * day), now],
      ),
    )
  ).rows;
  // Group by the word that most titles share, taking the biggest group first.
  const left = rows.map((r) => ({ ...r, words: new Set(keywords(r.title, 8)) }));
  const groups: { topic: string; items: typeof left }[] = [];
  while (left.length) {
    const count = new Map<string, number>();
    for (const r of left) for (const w of r.words) count.set(w, (count.get(w) ?? 0) + 1);
    const [topic] = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [];
    if (!topic) break;
    const items = left.filter((r) => r.words.has(topic));
    groups.push({ topic, items });
    for (const it of items) left.splice(left.indexOf(it), 1);
  }
  const weekAgo = now.getTime() - 7 * day;
  return groups
    .map(({ topic, items }) => {
      const thisWeek = items.filter((i) => i.created_at.getTime() >= weekAgo).length;
      const lastWeek = items.length - thisWeek;
      const signals = { uncovered: items.length > 0, growing: thisWeek >= 2 && thisWeek >= lastWeek, failing: items.some((i) => i.status === 'blocked') };
      const confirmed = Object.values(signals).filter(Boolean).length >= 2;
      const base = { topic, examples: items.slice(0, 3).map((i) => i.title), tasks: items.length, thisWeek, lastWeek, signals, confirmed };
      const f = chooseFork(base);
      return { ...base, fork: confirmed ? f.fork : null, why: f.why };
    })
    .sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || b.tasks - a.tasks);
}
