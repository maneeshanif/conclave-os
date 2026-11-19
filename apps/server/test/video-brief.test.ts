import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createExecutors } from '../src/actions';
import { outboxDmTransport, outboxPostTransport } from '../src/actions/post-transport';
import { OutboxTransport } from '../src/actions/transport';
import type { GenerationConnector, GenerationRequest } from '../src/video/generate';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool, osTools } from '../src/harness/os-tools';
import { CREDITS, estimateCredits } from '../src/video/briefs';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

let sys: System;
let store: DbOsStore;
let companyRoot = '';
let agentId = '';
let runId = '';
let taskId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const scope = () => ({ workspaceId: ws(), agentId, runId, taskId });
const tool = (name: string, args: unknown) => callOsTool(store, scope(), name, args).then((r) => ({ ok: true as const, text: r }), (e: Error) => ({ ok: false as const, text: e.message }));

const SHOTS = [
  { kind: 'text', description: 'Title card: Patients lose the booking at step two', seconds: 3 },
  { kind: 'clip', description: 'A phone screen, a patient giving up on a long form', seconds: 6 },
  { kind: 'image', description: 'A clean booking page with one big button', seconds: 4 },
];
const brief = (over: Record<string, unknown> = {}) => ({ ideaId: idea, title: 'The step-two problem', script: 'Most clinics lose patients at step two of their booking form. Here is what a one-tap page looks like instead.', shots: SHOTS, ...over });
let idea = '';
const newIdea = async (stage = 'brief') => (await sql("insert into video_ideas (workspace_id, source, idea, stage, created_by) values ($1, 'founder', 'step two problem', $2, 'founder') returning id", [ws(), stage])).rows[0].id as string;

class FakeGenerator implements GenerationConnector {
  readonly name = 'fake';
  calls: GenerationRequest[] = [];
  failOn: number | null = null;
  creditsPer = (r: GenerationRequest) => CREDITS[r.kind];
  async generate(r: GenerationRequest) {
    this.calls.push(r);
    if (this.failOn === this.calls.length) throw new Error('the generator is down');
    return { content: Buffer.from(`ASSET:${r.kind}:${r.description}`), mime: r.kind === 'clip' ? 'video/mp4' : 'image/png', credits: this.creditsPer(r) };
  }
}
let gen = new FakeGenerator();
const executors = (generator: GenerationConnector | null = gen) =>
  createExecutors({ pool: sys.app, workspaceId: ws(), transport: new OutboxTransport(path.join(sys.dataDir, 'outbox')), companyRoot, from: 'a@b.test', postTransport: outboxPostTransport(sys.dataDir), dmTransport: outboxDmTransport(sys.dataDir), ...(generator ? { generator } : {}), dataDir: sys.dataDir });
async function proposed(over: Record<string, unknown> = {}) {
  const r = await tool('propose_video_brief', brief(over));
  const id = /as ([0-9a-f-]{36})/.exec(r.text)?.[1];
  if (!id) throw new Error(`not queued: ${r.text}`);
  return id;
}
const approve = (id: string) => sql("update approvals set status = 'approved', decided_by = 'founder', decided_at = now() where id = $1", [id]);
const vb = async () => (await sql('select status, estimated_credits, spent_credits, error from video_briefs order by created_at desc limit 1')).rows[0];
const assets = async () => (await sql('select shot, kind, key, credits from video_assets order by shot')).rows;

beforeAll(async () => {
  ({ sys } = await testSystem());
  companyRoot = await mkdtemp(path.join(tmpdir(), 'conclave-co-vid-'));
  await writeFile(path.join(companyRoot, 'COMPANY.md'), '# Acme\nBuilds start at $1,500.\n');
  store = new DbOsStore(sys.app, () => undefined, companyRoot);
  await agentNew(sys, { template: 'writer', department: 'marketing', id: 'vid-writer' });
  agentId = (await sql("select id from agents where key = 'vid-writer'")).rows[0].id;
  taskId = (await sql("insert into tasks (workspace_id, title, status, assignee_id, locked_by, created_by) values ($1, 'brief', 'in_progress', $2, $2, 'founder') returning id", [ws(), agentId])).rows[0].id;
  runId = (await sql("insert into runs (workspace_id, agent_id, task_id, trigger, runtime, status) values ($1, $2, $3, 'manual', 'claude-cli', 'running') returning id", [ws(), agentId, taskId])).rows[0].id;
}, 240_000);
afterAll(async () => sys?.close());
beforeEach(async () => {
  await rm(path.join(sys.dataDir, 'assets'), { recursive: true, force: true });
  await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0', [ws()]);
  await sql('update agents set autonomy = 2 where id = $1', [agentId]);
  await sql('delete from video_assets');
  await sql('delete from video_briefs');
  await sql('delete from action_items where approval_id is not null');
  await sql("delete from action_items where kind in ('executor_failed','send_unknown','generator_missing')");
  await sql("delete from approvals where kind = 'video.brief'");
  await sql('delete from video_ideas');
  idea = await newIdea();
  gen = new FakeGenerator();
});

describe('counting credits (S5-8)', () => {
  it('counts them from the shot list: text cards are free, an image is 1, a clip is 5', () => {
    expect(CREDITS).toEqual({ text: 0, image: 1, clip: 5 });
    expect(estimateCredits(SHOTS as never)).toBe(6);
    expect(estimateCredits([])).toBe(0);
  });
});

describe('propose_video_brief (S5-8)', () => {
  it('needs autonomy 2', async () => {
    expect(osTools.propose_video_brief.minAutonomy).toBe(2);
    await sql('update agents set autonomy = 1 where id = $1', [agentId]);
    expect((await tool('propose_video_brief', brief())).text).toMatch(/Unknown tool/);
  });

  it('queues one pending approval with the credits counted from the shots, and generates nothing', async () => {
    const r = await tool('propose_video_brief', brief());
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/Queued for approval.*6 credits.*Nothing has been generated/s);
    const ap = (await sql("select status, payload from approvals where kind = 'video.brief'")).rows[0];
    expect(ap).toMatchObject({ status: 'pending' });
    expect(ap.payload).toMatchObject({ title: 'The step-two problem', estimatedCredits: 6, shots: 3 });
    expect(await vb()).toMatchObject({ status: 'pending_approval', estimated_credits: 6, spent_credits: 0 });
    expect(gen.calls).toHaveLength(0);
  });

  it('takes no credit figure from the agent, and refuses unknown fields and shot kinds', async () => {
    expect((await tool('propose_video_brief', brief({ estimatedCredits: 0 }))).ok).toBe(false);
    expect((await tool('propose_video_brief', brief({ shots: [{ kind: 'hologram', description: 'x', seconds: 3 }] }))).ok).toBe(false);
    expect((await tool('propose_video_brief', brief({ shots: [{ kind: 'clip', description: 'x', seconds: 3, credits: 0 }] }))).ok).toBe(false);
  });

  it('holds the shot list to sensible bounds: at least one shot, at most 20, seconds 1 to 30, total under 3 minutes', async () => {
    expect((await tool('propose_video_brief', brief({ shots: [] }))).ok).toBe(false);
    expect((await tool('propose_video_brief', brief({ shots: Array.from({ length: 21 }, () => ({ kind: 'text', description: 'x', seconds: 2 })) }))).ok).toBe(false);
    expect((await tool('propose_video_brief', brief({ shots: [{ kind: 'clip', description: 'x', seconds: 31 }] }))).ok).toBe(false);
    expect((await tool('propose_video_brief', brief({ shots: Array.from({ length: 10 }, () => ({ kind: 'text', description: 'x', seconds: 30 })) }))).text).toMatch(/3 minutes/);
  });

  it('applies the claims and price rules to the script and the shot text', async () => {
    expect((await tool('propose_video_brief', brief({ script: 'Our redesign will cure slow sites, guaranteed results.' }))).text).toMatch(/medical claim/);
    expect((await tool('propose_video_brief', brief({ script: 'Sites from $99 only.' }))).text).toMatch(/price not in COMPANY\.md/);
    expect((await tool('propose_video_brief', brief({ shots: [{ kind: 'text', description: 'Only $49 this week', seconds: 3 }] }))).text).toMatch(/price not in COMPANY\.md/);
    expect((await tool('propose_video_brief', brief({ script: 'Builds start at $1,500.' }))).ok).toBe(true);
  });

  it('needs an idea that a person turned into a brief, and allows one live brief per idea', async () => {
    expect((await tool('propose_video_brief', brief({ ideaId: await newIdea('idea') }))).text).toMatch(/not been turned into a brief/i);
    expect((await tool('propose_video_brief', brief({ ideaId: '00000000-0000-4000-8000-000000000000' }))).text).toMatch(/No such idea/);
    await tool('propose_video_brief', brief());
    expect((await tool('propose_video_brief', brief({ title: 'Another try' }))).text).toMatch(/already has a brief/i);
    await sql("update video_briefs set status = 'rejected'");
    await sql("update approvals set status = 'rejected'");
    expect((await tool('propose_video_brief', brief({ title: 'Third try' }))).ok).toBe(true);
  });
});

describe('generating after the approval, and only then (S5-8)', () => {
  it('generates nothing while the brief is pending, rejected or expired', async () => {
    const ex = executors();
    for (const status of ['pending', 'rejected', 'expired']) {
      const id = await proposed({ title: `T ${status}`, ideaId: await newIdea() });
      await sql('update approvals set status = $2 where id = $1', [id, status]);
      expect(await ex.run(id)).toMatchObject({ status: 'already_claimed' });
    }
    expect(gen.calls).toHaveLength(0);
  });

  it('generates each image and clip once, stores them by key in the data folder, records the credits, and moves the idea on', async () => {
    const id = await proposed();
    await approve(id);
    const ex = executors();
    expect(await ex.run(id)).toMatchObject({ status: 'executed' });
    expect(gen.calls.map((c) => c.kind)).toEqual(['clip', 'image']); // the text card needs nothing generated
    const rows = await assets();
    expect(rows.map((r) => r.shot)).toEqual([2, 3]);
    expect(rows.reduce((a, r) => a + r.credits, 0)).toBe(6);
    for (const r of rows) {
      expect(r.key).toMatch(/^assets\/[0-9a-f-]{36}\/shot-\d+\.(mp4|png)$/);
      expect(readFileSync(path.join(sys.dataDir, r.key), 'utf8')).toMatch(/^ASSET:/);
    }
    expect(await vb()).toMatchObject({ status: 'generated', spent_credits: 6 });
    expect((await sql('select stage from video_ideas where id = $1', [idea])).rows[0].stage).toBe('assets');
    expect((await sql("select result from approvals where id = $1", [id])).rows[0].result).toMatchObject({ credits: 6, assets: 2, connector: 'fake' });
    expect(await ex.run(id)).toMatchObject({ status: 'already_claimed' });
    expect(gen.calls).toHaveLength(2);
  });

  it('generates once however many times it is asked at once', async () => {
    const id = await proposed();
    await approve(id);
    const ex = executors();
    await Promise.all([ex.run(id), ex.run(id), ex.run(id)]);
    expect(gen.calls).toHaveLength(2);
  });

  it('does nothing while the kill switch is on, and the brief stays approved', async () => {
    const id = await proposed();
    await approve(id);
    await sql('update workspace_settings set kill_switch = 1 where workspace_id = $1', [ws()]);
    expect(await executors().run(id)).toMatchObject({ status: 'kill_switch' });
    expect(gen.calls).toHaveLength(0);
    expect((await sql('select status from approvals where id = $1', [id])).rows[0].status).toBe('approved');
  });

  it('stops, and says so, when the generator would spend more credits than the brief was approved for', async () => {
    const id = await proposed();
    await approve(id);
    gen.creditsPer = () => 10; // every asset costs more than estimated
    const r = await executors().run(id);
    expect(r).toMatchObject({ status: 'failed', reason: expect.stringMatching(/more credits than approved/i) });
    expect(gen.calls).toHaveLength(1); // stopped at the first overrun
    expect(await vb()).toMatchObject({ status: 'failed' });
    expect((await sql("select count(*)::int as n from action_items where kind = 'executor_failed'")).rows[0].n).toBe(1);
  });

  it('never retries a failed generation: the first asset is kept, the brief fails with an item, one call each', async () => {
    const id = await proposed();
    await approve(id);
    gen.failOn = 2;
    expect(await executors().run(id)).toMatchObject({ status: 'failed', reason: expect.stringMatching(/generator is down/) });
    expect(gen.calls).toHaveLength(2);
    expect((await assets()).map((a) => a.shot)).toEqual([2]);
    expect(await vb()).toMatchObject({ status: 'failed', spent_credits: 5 });
    expect(await executors().run(id)).toMatchObject({ status: 'already_claimed' });
    expect(gen.calls).toHaveLength(2);
  });

  it('refuses, with an item, when no generation connector is set up, and spends nothing', async () => {
    const id = await proposed();
    await approve(id);
    expect(await executors(null).run(id)).toMatchObject({ status: 'refused', reason: expect.stringMatching(/no generation connector/i) });
    expect((await sql("select count(*)::int as n from action_items where kind = 'executor_failed'")).rows[0].n).toBe(1);
    expect(existsSync(path.join(sys.dataDir, 'assets')) ? readdirSync(path.join(sys.dataDir, 'assets')).length : 0).toBe(0);
  });

  it('marks a brief left mid-generation as failed with an item and never generates it again', async () => {
    const id = await proposed();
    await approve(id);
    await sql("update approvals set status = 'executing' where id = $1", [id]);
    await sql("update video_briefs set status = 'generating'");
    const r = await executors().recover();
    expect(r.unknown).toContain(id);
    expect(await vb()).toMatchObject({ status: 'failed' });
    expect(gen.calls).toHaveLength(0);
  });
});
