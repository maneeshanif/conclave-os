import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withWorkspace } from '../src/db/tenant';
import { assembleBrief, assembleGenerated, buildPlan, parseBrand, planJson, type Brand } from '../src/video/assemble';
import { reviewPlan } from '../src/video/review';
import type { Shot } from '../src/video/briefs';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

const BRAND: Brand = { primary: '#0A5C4B', text: '#FFFFFF', logo: 'brand/logo.png' };
const SHOTS: Shot[] = [
  { kind: 'text', description: 'Patients lose the booking at step two', seconds: 3 },
  { kind: 'clip', description: 'A phone screen, a patient giving up on a long form', seconds: 6 },
  { kind: 'image', description: 'A clean booking page with one big button', seconds: 4 },
];
const SCRIPT = 'Most clinics lose patients at step two of their booking form. Here is what a one tap page looks like instead. Book in two taps.';
const ASSETS = [
  { shot: 2, key: 'assets/b1/shot-2.mp4', kind: 'clip' },
  { shot: 3, key: 'assets/b1/shot-3.png', kind: 'image' },
];
const COMPANY = '# Acme\nBuilds start at $1,500.\n\n## Brand\n- primary: #0A5C4B\n- text: #FFFFFF\n- logo: brand/logo.png\n';
const input = (over: Partial<{ shots: Shot[]; script: string; assets: typeof ASSETS; brand: Brand }> = {}) => ({ title: 'T', script: SCRIPT, shots: SHOTS, assets: ASSETS, brand: BRAND, ...over });

describe('the assembly plan (S5-9)', () => {
  it('lays the scenes end to end in shot order, text cards from the description and the rest from their assets', () => {
    const p = buildPlan(input());
    expect(p.scenes).toEqual([
      { shot: 1, kind: 'text', start: 0, duration: 3, text: 'Patients lose the booking at step two', assetKey: null },
      { shot: 2, kind: 'clip', start: 3, duration: 6, text: null, assetKey: 'assets/b1/shot-2.mp4' },
      { shot: 3, kind: 'image', start: 9, duration: 4, text: null, assetKey: 'assets/b1/shot-3.png' },
    ]);
    expect(p.durationSeconds).toBe(13);
    expect(p.brand).toEqual(BRAND);
  });

  it('gives captions from the script, one sentence each, spread over the whole length in order', () => {
    const p = buildPlan(input());
    expect(p.captions.map((c) => c.text)).toEqual(['Most clinics lose patients at step two of their booking form.', 'Here is what a one tap page looks like instead.', 'Book in two taps.']);
    expect(p.captions[0]!.start).toBe(0);
    expect(p.captions.at(-1)!.end).toBe(13);
    for (let i = 1; i < p.captions.length; i++) expect(p.captions[i]!.start).toBe(p.captions[i - 1]!.end);
  });

  it('is the same plan, byte for byte, for the same inputs, however the asset list is ordered', () => {
    const a = planJson(buildPlan(input()));
    expect(planJson(buildPlan(input()))).toBe(a);
    expect(planJson(buildPlan(input({ assets: [...ASSETS].reverse() })))).toBe(a);
    expect(planJson(buildPlan(input({ shots: [{ ...SHOTS[0]!, seconds: 4 }, ...SHOTS.slice(1)] })))).not.toBe(a);
  });

  it('reads the brand from the company file, and says when it is missing', () => {
    expect(parseBrand(COMPANY)).toEqual(BRAND);
    expect(parseBrand('# Acme\nNo brand here')).toBeNull();
    expect(parseBrand('## Brand\n- primary: red\n- text: #fff\n- logo: l.png')).toBeNull(); // not a hex colour
  });
});

describe('the review check (S5-9)', () => {
  const review = (over: Parameters<typeof input>[0] = {}, companyMd = COMPANY) => {
    const i = input(over);
    return reviewPlan(buildPlan(i), { shots: i.shots, script: i.script }, companyMd);
  };

  it('passes a complete plan', () => {
    expect(review()).toEqual({ ok: true, reasons: [] });
  });

  it('fails a shot that needs an asset and has none', () => {
    const r = review({ assets: [ASSETS[0]!] });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/shot 3.*no asset/i);
  });

  it('fails a plan whose length is not the brief\'s, or is over three minutes', () => {
    const i = input();
    const p = buildPlan(i);
    expect(reviewPlan({ ...p, durationSeconds: 99 }, { shots: i.shots, script: i.script }, COMPANY).reasons.join(' ')).toMatch(/length|duration/i);
    const long = Array.from({ length: 7 }, () => ({ kind: 'text', description: 'x', seconds: 30 }) as Shot);
    expect(review({ shots: long }).reasons.join(' ')).toMatch(/3 minutes/);
  });

  it('fails when there are no captions, or one that runs past the end', () => {
    const i = input();
    const p = buildPlan(i);
    expect(reviewPlan({ ...p, captions: [] }, { shots: i.shots, script: i.script }, COMPANY).reasons.join(' ')).toMatch(/captions/i);
    expect(reviewPlan({ ...p, captions: [{ start: 0, end: 50, text: 'x' }] }, { shots: i.shots, script: i.script }, COMPANY).reasons.join(' ')).toMatch(/captions.*end/i);
    expect(review({ script: '   ' }).reasons.join(' ')).toMatch(/captions/i);
  });

  it('fails without the brand colours or the logo', () => {
    expect(review({ brand: { ...BRAND, primary: 'green' } }).reasons.join(' ')).toMatch(/brand colou?r/i);
    expect(review({ brand: { ...BRAND, logo: '' } }).reasons.join(' ')).toMatch(/logo/i);
  });

  it('fails a blocked claim or an unlisted price in the captions or a text card', () => {
    expect(review({ script: 'Our redesign will cure slow sites, guaranteed results.' }).reasons.join(' ')).toMatch(/medical claim/);
    expect(review({ shots: [{ kind: 'text', description: 'Only $49 this week', seconds: 3 }, ...SHOTS.slice(1)] }).reasons.join(' ')).toMatch(/price not in COMPANY\.md/);
    expect(review({ script: 'Builds start at $1,500.' }).ok).toBe(true);
  });

  it('lists every problem at once', () => {
    const r = review({ assets: [], brand: { ...BRAND, logo: '' } });
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe('assembling a brief in the database (S5-9)', () => {
  let sys: System;
  const ws = () => sys.workspace.id;
  const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
  let briefId = '';

  beforeAll(async () => {
    ({ sys } = await testSystem());
  }, 180_000);
  afterAll(async () => sys?.close());
  beforeEach(async () => {
    await sql('delete from video_assets');
    await sql('delete from video_briefs');
    await sql('delete from approvals where kind = \'video.publish\'');
    await sql('delete from video_ideas');
    const idea = (await sql("insert into video_ideas (workspace_id, source, idea, stage, created_by) values ($1, 'founder', 'i', 'assets', 'founder') returning id", [ws()])).rows[0].id;
    briefId = (await sql("insert into video_briefs (workspace_id, idea_id, title, script, shots, status, estimated_credits, spent_credits, created_by) values ($1, $2, 'T', $3, $4, 'generated', 6, 6, 'x') returning id", [ws(), idea, SCRIPT, JSON.stringify(SHOTS)])).rows[0].id;
    for (const a of ASSETS) await sql('insert into video_assets (workspace_id, brief_id, shot, kind, key, mime, credits) values ($1, $2, $3, $4, $5, $6, 1)', [ws(), briefId, a.shot, a.kind, a.key, a.kind === 'clip' ? 'video/mp4' : 'image/png']);
  });

  it('stores the plan, its hash and a passing review, and marks the brief ready', async () => {
    const r = await withWorkspace(sys.app, ws(), ({ client }) => assembleBrief(client, ws(), briefId, COMPANY));
    expect(r.ok).toBe(true);
    const row = (await sql('select status, plan, plan_hash, review from video_briefs where id = $1', [briefId])).rows[0];
    expect(row.status).toBe('ready');
    expect(row.plan.durationSeconds).toBe(13);
    expect(row.plan_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.review).toEqual({ ok: true, reasons: [] });
  });

  it('gives the same hash when assembled again', async () => {
    const run = () => withWorkspace(sys.app, ws(), ({ client }) => assembleBrief(client, ws(), briefId, COMPANY));
    await run();
    const first = (await sql('select plan_hash from video_briefs')).rows[0].plan_hash;
    await sql("update video_briefs set status = 'generated'");
    await run();
    expect((await sql('select plan_hash from video_briefs')).rows[0].plan_hash).toBe(first);
  });

  it('marks a plan that fails review as review_failed with the reasons, and offers nothing for approval', async () => {
    await sql('delete from video_assets where shot = 3');
    const r = await withWorkspace(sys.app, ws(), ({ client }) => assembleBrief(client, ws(), briefId, COMPANY));
    expect(r.ok).toBe(false);
    const row = (await sql('select status, review from video_briefs where id = $1', [briefId])).rows[0];
    expect(row.status).toBe('review_failed');
    expect(row.review.reasons.join(' ')).toMatch(/shot 3/);
    expect((await sql("select count(*)::int as n from approvals where kind = 'video.publish'")).rows[0].n).toBe(0);
  });

  it('fails review, saying so, when the company file has no brand', async () => {
    const r = await withWorkspace(sys.app, ws(), ({ client }) => assembleBrief(client, ws(), briefId, '# Acme\nNo brand section.'));
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/brand/i);
  });

  it('assembles every generated brief when the ticker asks, and leaves the others alone', async () => {
    const out = await assembleGenerated(sys.app, ws(), COMPANY);
    expect(out).toEqual({ ready: [briefId], failed: [] });
    expect((await assembleGenerated(sys.app, ws(), COMPANY))).toEqual({ ready: [], failed: [] }); // already done
  });

  it('only assembles a brief whose assets were generated', async () => {
    await sql("update video_briefs set status = 'pending_approval'");
    await expect(withWorkspace(sys.app, ws(), ({ client }) => assembleBrief(client, ws(), briefId, COMPANY))).rejects.toThrow(/not been generated/i);
  });
});
