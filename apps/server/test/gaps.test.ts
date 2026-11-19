import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { chooseFork, gapCheck } from '../src/talent/gaps';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

/** The gap check (S8-9): two of three signals make a gap, and a gap is not automatically a hire. */
let sys: System;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const NOW = new Date('2026-11-19T12:00:00Z');
const task = (title: string, daysAgo: number, status = 'todo') => sql("insert into tasks (workspace_id, title, status, created_by, created_at) values ($1, $2, $3, 'founder', $4)", [ws(), title, status, new Date(NOW.getTime() - daysAgo * 86_400_000)]);

beforeAll(async () => {
  ({ sys } = await testSystem());
}, 240_000);
afterAll(() => sys?.close());

describe('the gap check (S8-9)', () => {
  it('says nothing when there is no uncovered work', async () => {
    expect(await gapCheck(sys.app, ws(), NOW)).toEqual([]);
  });

  it('does not call one signal a gap: a single uncovered task is not confirmed', async () => {
    await task('Translate the brochure into Urdu', 1);
    const [g] = await gapCheck(sys.app, ws(), NOW);
    expect(g).toMatchObject({ confirmed: false, fork: null });
    expect(g!.signals).toEqual({ uncovered: true, growing: false, failing: false });
  });

  it('confirms a gap that keeps coming, and chooses hire when it is growing and high-volume', async () => {
    for (const d of [1, 2, 3, 4]) await task(`Edit client video ${d}`, d);
    await task('Edit client video 0', 9);
    const gaps = await gapCheck(sys.app, ws(), NOW);
    const g = gaps.find((x) => x.examples.some((t) => /video/.test(t)))!;
    expect(g).toMatchObject({ confirmed: true, fork: 'hire', thisWeek: 4, lastWeek: 1 });
    expect(g.signals).toMatchObject({ uncovered: true, growing: true });
    expect(gaps[0]).toBe(g); // confirmed gaps come first
  });

  it('escalates a gap that is rare and went wrong, and the forks follow their rules', async () => {
    await task('Draft a lease for the Karachi office', 3, 'blocked');
    await task('Draft a lease for the Lahore office', 10);
    const lease = (await gapCheck(sys.app, ws(), NOW)).find((x) => x.examples.some((t) => /lease/.test(t)))!;
    expect(lease.signals).toMatchObject({ uncovered: true, growing: false, failing: true });
    expect(lease).toMatchObject({ confirmed: true, fork: 'escalate' });
    expect(chooseFork({ tasks: 3, thisWeek: 1, lastWeek: 2, signals: { uncovered: true, growing: true, failing: false }, confirmed: true }).fork).toBe('queue');
    expect(chooseFork({ tasks: 1, thisWeek: 1, lastWeek: 0, signals: { uncovered: true, growing: false, failing: false }, confirmed: false }).fork).toBe('decline');
  });

  it('does not count work an active agent has, or work that is finished', async () => {
    await agentNew(sys, { template: 'writer', department: 'outreach', id: 'gap-w', name: 'W' });
    const id = (await sql("select id from agents where key = 'gap-w'")).rows[0].id as string;
    await sql("update agents set status = 'active' where id = $1", [id]);
    for (const d of [1, 2, 3]) await sql("insert into tasks (workspace_id, title, status, assignee_id, created_by, created_at) values ($1, $2, 'todo', $3, 'founder', $4)", [ws(), `Write newsletter ${d}`, id, new Date(NOW.getTime() - d * 86_400_000)]);
    await task('Archive old invoices', 2, 'done');
    expect((await gapCheck(sys.app, ws(), NOW)).some((x) => x.examples.some((t) => /newsletter|invoices/.test(t)))).toBe(false);
  });
});
