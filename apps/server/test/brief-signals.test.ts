import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildBrief } from '../src/brief/build';
import { withWorkspace } from '../src/db/tenant';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

let sys: System;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const NOW = new Date('2026-11-13T06:30:00Z');
const brief = () => withWorkspace(sys.app, ws(), ({ client }) => buildBrief(client, NOW));
let n = 0;
const sig = (status: string, score: number | null, updatedHoursAgo: number, over: Record<string, string> = {}) =>
  sql(
    `insert into signals (workspace_id, kind, source, url, author, excerpt, status, score, found_by, found_at, updated_at)
     values ($1, $2, 'reddit', $3, $4, $5, $6, $7, 'agent:scout-1', $8, $8)`,
    [ws(), over.kind ?? 'service_request', `https://reddit.example/p/${++n}`, over.author ?? `u/user${n}`, over.excerpt ?? `Excerpt ${n}`, status, score, new Date(NOW.getTime() - updatedHoursAgo * 3_600_000)],
  );

beforeAll(async () => {
  ({ sys } = await testSystem());
}, 180_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await sql('delete from signals');
  await sql('delete from leads');
  await sql('delete from action_items');
  await sql('delete from approvals');
  await sql('delete from tasks');
  await sql('delete from outreach_messages');
});

describe('signals in the morning brief (S4-8)', () => {
  it('counts the qualified signals waiting, how many are new since yesterday, and lists the best first', async () => {
    await sig('qualified', 90, 2, { excerpt: 'Need a clinic booking page rebuilt.' });
    await sig('qualified', 65, 5);
    await sig('qualified', 78, 60); // qualified two days ago, still waiting
    await sig('new', 40, 1); // scored low: not in the list
    await sig('dismissed', 80, 1);
    await sig('promoted', 95, 1);
    const b = await brief();
    expect(b.content.signals).toMatchObject({ waiting: 3, new: 2 });
    expect(b.content.signals.items.map((s) => s.score)).toEqual([90, 78, 65]);
    expect(b.content.signals.items[0]).toMatchObject({ kind: 'service_request', source: 'reddit', author: expect.any(String), excerpt: 'Need a clinic booking page rebuilt.' });
    expect(b.content.signals.items[0]!.url).toMatch(/^https:\/\/reddit\.example\/p\//);
    expect(b.summary).toContain('3 qualified signals waiting (2 new since yesterday).');
    expect(b.quiet).toBe(false);
  });

  it('shows at most five, still counting all of them', async () => {
    for (let i = 0; i < 8; i++) await sig('qualified', 60 + i, 1);
    const b = await brief();
    expect(b.content.signals.waiting).toBe(8);
    expect(b.content.signals.items).toHaveLength(5);
    expect(b.content.signals.items[0]!.score).toBe(67);
  });

  it('says one signal in the singular, and leaves the line out when there are none', async () => {
    await sig('qualified', 70, 1);
    expect((await brief()).summary).toContain('1 qualified signal waiting (1 new since yesterday).');
    await sql('delete from signals');
    const empty = await brief();
    expect(empty.content.signals).toEqual({ waiting: 0, new: 0, items: [] });
    expect(empty.summary.some((l) => /signal/.test(l))).toBe(false);
    expect(empty.quiet).toBe(true);
  });

  it('keeps an excerpt short in the brief and never lists a dismissed or promoted signal', async () => {
    await sig('qualified', 88, 1, { excerpt: 'x'.repeat(900) });
    await sig('dismissed', 99, 1);
    const b = await brief();
    expect(b.content.signals.items).toHaveLength(1);
    expect(b.content.signals.items[0]!.excerpt!.length).toBeLessThanOrEqual(240);
  });
});
