import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createExecutors } from '../src/actions';
import { browserPostTransport, outboxDmTransport, outboxPostTransport, SessionExpiredError, type BrowserDriver } from '../src/actions/post-transport';
import { OutboxTransport } from '../src/actions/transport';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { createNotifier, PUSH_MESSAGES, type PushSender, type Subscription } from '../src/push';
import type { System } from '../src/system';
import { assembleGenerated } from '../src/video/assemble';
import { CREDITS } from '../src/video/briefs';
import type { GenerationConnector, GenerationRequest } from '../src/video/generate';
import { LocalApprovalGate } from '../src/workflows/approval-gate';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

/**
 * Slice 5 end to end (S5-11, SPEC 18 row 5): you approve a post or a video on your phone and it is live, with a screenshot in the
 * record. The real proposal tools, approval API, gate, executors, video pipeline and push; the browser, the generator and the push
 * service are stand-ins. Nothing goes to a real site.
 */
const COMPANY = `# Acme Test Co
We build booking pages for clinics. Builds start at $1,500.

## Approved link domains
- acme.test

## Brand
- primary: #0A5C4B
- text: #FFFFFF
- logo: brand/logo.png
`;
const json = { 'content-type': 'application/json' };

let sys: System;
let app: ReturnType<typeof createApp>;
let gate: LocalApprovalGate;
let store: DbOsStore;
let companyRoot = '';
let agentId = '';
let runId = '';
let taskId = '';
let xAccount = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const tool = (name: string, args: unknown) => callOsTool(store, { workspaceId: ws(), agentId, runId, taskId }, name, args);
const call = (method: string, p: string, body?: unknown) => app.request(`/api${p}`, { method, headers: { ...json, 'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile' }, body: body === undefined ? undefined : JSON.stringify(body) });
const wait = async (cond: () => Promise<boolean>, ms = 4000) => {
  for (let i = 0; i < ms / 50 && !(await cond()); i++) await new Promise((r) => setTimeout(r, 50));
};
const approval = async (id: string) => (await sql('select status, result from approvals where id = $1', [id])).rows[0];
const idOf = (text: string) => /as ([0-9a-f-]{36})/.exec(text)![1]!;

class FakeSender implements PushSender {
  sent: string[] = [];
  async send(_s: Subscription, payload: string) {
    this.sent.push(payload);
    return { ok: true as const };
  }
}
const sender = new FakeSender();
const pushes = () => sender.sent.map((p) => JSON.parse(p) as { title: string });

const driverCalls: { text: string; media?: unknown }[] = [];
let driverMode: 'ok' | 'crash' | 'login' = 'ok';
const driver: BrowserDriver = {
  async publish(a) {
    driverCalls.push({ text: a.text, ...(a.media ? { media: a.media } : {}) });
    if (driverMode === 'login') throw new SessionExpiredError('login page');
    if (driverMode === 'crash') throw new Error('The page crashed after pressing Post');
    return { finalUrl: `https://x.test/acme_test/status/${driverCalls.length}`, screenshot: Buffer.from(`PNG-${driverCalls.length}`) };
  },
};
const genCalls: GenerationRequest[] = [];
const generator: GenerationConnector = {
  name: 'fake',
  async generate(r) {
    genCalls.push(r);
    return { content: Buffer.from(`ASSET:${r.kind}`), mime: r.kind === 'clip' ? 'video/mp4' : 'image/png', credits: CREDITS[r.kind] };
  },
};

beforeAll(async () => {
  ({ sys } = await testSystem());
  companyRoot = await mkdtemp(path.join(tmpdir(), 'conclave-co-s5-'));
  await writeFile(path.join(companyRoot, 'COMPANY.md'), COMPANY);
  const bus = new Bus();
  const notifier = createNotifier({ pool: sys.app, workspaceId: ws(), sender });
  notifier.attach(bus);
  await notifier.subscribe({ endpoint: 'https://push.example.test/phone', keys: { p256dh: 'k1', auth: 'a1' } }, 'Pixel 7');
  const executors = createExecutors({
    pool: sys.app,
    workspaceId: ws(),
    bus,
    transport: new OutboxTransport(path.join(sys.dataDir, 'outbox')),
    companyRoot,
    from: 'a@b.test',
    postTransport: outboxPostTransport(sys.dataDir),
    browserPostTransport: browserPostTransport(sys.dataDir, driver),
    dmTransport: outboxDmTransport(sys.dataDir),
    generator,
    dataDir: sys.dataDir,
  });
  gate = new LocalApprovalGate({ pool: sys.app, workspaceId: ws(), bus, executors });
  // The same two hooks the server wires: a queued proposal starts its wait and tells the phone.
  store = new DbOsStore(sys.app, () => undefined, companyRoot, (_w, id) => {
    void gate.requested(id);
    void notifier.notify('approval_waiting', id);
  });
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store, bus, dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), onApprovalDecided: (d) => gate.decided(d), push: { notifier, publicKey: 'x' } });
  await agentNew(sys, { template: 'content-writer', department: 'marketing', id: 'e2e-writer', autonomy: 2 });
  agentId = (await sql("select id from agents where key = 'e2e-writer'")).rows[0].id;
  taskId = (await sql("insert into tasks (workspace_id, title, status, assignee_id, locked_by, created_by) values ($1, 'content', 'in_progress', $2, $2, 'founder') returning id", [ws(), agentId])).rows[0].id;
  runId = (await sql("insert into runs (workspace_id, agent_id, task_id, trigger, runtime, status) values ($1, $2, $3, 'manual', 'claude-cli', 'running') returning id", [ws(), agentId, taskId])).rows[0].id;
  xAccount = (await sql("insert into channel_accounts (workspace_id, channel, handle) values ($1, 'x', '@acme_test') returning id", [ws()])).rows[0].id;
  // The login was done by hand once; here it is recorded as done, then the account is switched to the browser the deliberate way.
  await sql("update channel_accounts set browser_profile = id::text, session_state = 'valid' where id = $1", [xAccount]);
  expect((await call('POST', `/browser/accounts/${xAccount}/transport`, { transport: 'browser' })).status).toBe(200);
}, 240_000);
afterAll(async () => {
  gate?.stop();
  await sys?.close();
});

describe('slice 5 end to end', () => {
  it('(1) a post is proposed, approved from a phone, published through the browser, and the record has the screenshot and the address', async () => {
    const out = await tool('propose_post', { accountId: xAccount, text: 'We rebuilt a clinic booking page so patients can book in two taps. Details: https://acme.test/cases' });
    const id = idOf(out);
    await wait(async () => pushes().length >= 1);
    expect(pushes()).toEqual([PUSH_MESSAGES.approval_waiting]); // the phone was told, once, with no post text
    expect(sender.sent[0]).not.toContain('clinic');
    expect(driverCalls).toHaveLength(0); // proposing published nothing

    expect((await call('POST', `/approvals/${id}/decide`, { approved: true })).status).toBe(200);
    await wait(async () => (await approval(id)).status === 'executed');
    const a = await approval(id);
    expect(a.status).toBe('executed');
    expect(a.result).toMatchObject({ transport: 'browser', url: 'https://x.test/acme_test/status/1', screenshot: `screenshots/${id}.png` });
    expect(readFileSync(path.join(sys.dataDir, a.result.screenshot), 'utf8')).toBe('PNG-1');
    expect(driverCalls[0]!.text).toContain('book in two taps'); // exactly the text that was approved
    expect((await sql('select status, published_url from posts where approval_id = $1', [id])).rows[0]).toMatchObject({ status: 'published', published_url: 'https://x.test/acme_test/status/1' });
    expect(pushes()).toHaveLength(1); // a success is not news
  }, 60_000);

  it('(2) a video: an idea is turned into a brief, the brief is approved, assets are generated, the plan passes review, the approved video is published the same way', async () => {
    const idea = (await (await call('POST', '/video-ideas', { idea: 'Show how a booking form loses patients at step two' })).json()) as { id: string };
    expect((await call('POST', `/video-ideas/${idea.id}/brief`)).status).toBe(200);

    const briefOut = await tool('propose_video_brief', {
      ideaId: idea.id,
      title: 'The step-two problem',
      script: 'Most clinics lose patients at step two of their booking form. Here is a one tap page instead. Book in two taps.',
      shots: [
        { kind: 'text', description: 'Patients lose the booking at step two', seconds: 3 },
        { kind: 'clip', description: 'A phone screen, a patient giving up on a long form', seconds: 6 },
        { kind: 'image', description: 'A clean booking page with one big button', seconds: 4 },
      ],
    });
    expect(briefOut).toMatch(/6 credits/);
    expect(genCalls).toHaveLength(0); // nothing generated before approval
    const briefApproval = idOf(briefOut);
    await wait(async () => pushes().length >= 2);
    expect(pushes().at(-1)).toEqual(PUSH_MESSAGES.approval_waiting);

    expect((await call('POST', `/approvals/${briefApproval}/decide`, { approved: true })).status).toBe(200);
    await wait(async () => (await approval(briefApproval)).status === 'executed');
    expect(genCalls.map((g) => g.kind)).toEqual(['clip', 'image']);
    expect((await approval(briefApproval)).result).toMatchObject({ credits: 6, assets: 2 });

    // The ticker's step: a generated brief is laid out and reviewed.
    const assembled = await assembleGenerated(sys.app, ws(), COMPANY);
    expect(assembled.ready).toHaveLength(1);
    const brief = (await sql('select id, status, plan_hash, review from video_briefs')).rows[0];
    expect(brief).toMatchObject({ status: 'ready', review: { ok: true } });

    // The video is proposed as a post with the brief attached, approved, and published through the browser.
    const out = await tool('propose_post', { accountId: xAccount, text: 'Why patients give up on booking forms, in 13 seconds.', briefId: brief.id });
    const postApproval = idOf(out);
    await wait(async () => pushes().length >= 3);
    expect((await call('POST', `/approvals/${postApproval}/decide`, { approved: true })).status).toBe(200);
    await wait(async () => (await approval(postApproval)).status === 'executed');
    const a = await approval(postApproval);
    expect(a.result).toMatchObject({ transport: 'browser', screenshot: `screenshots/${postApproval}.png` });
    expect(existsSync(path.join(sys.dataDir, a.result.screenshot))).toBe(true);
    expect(driverCalls.at(-1)!.media).toMatchObject({ briefId: brief.id, planHash: brief.plan_hash });
    expect((await sql('select status from video_briefs where id = $1', [brief.id])).rows[0].status).toBe('published');
    expect((await sql('select stage from video_ideas where id = $1', [idea.id])).rows[0].stage).toBe('published');
  }, 90_000);

  it('(3) a video whose plan has not passed review cannot be attached to a post, and a changed plan is not published', async () => {
    const idea = (await sql("insert into video_ideas (workspace_id, source, idea, stage, created_by) values ($1, 'founder', 'another', 'assets', 'founder') returning id", [ws()])).rows[0].id;
    const brief = (await sql("insert into video_briefs (workspace_id, idea_id, title, script, shots, status, estimated_credits, plan_hash, created_by) values ($1, $2, 'T', 'S.', '[]', 'review_failed', 0, 'abc', 'x') returning id", [ws(), idea])).rows[0].id;
    await expect(tool('propose_post', { accountId: xAccount, text: 'A video that is not ready.', briefId: brief })).rejects.toThrow(/not ready|review/i);

    await sql("update video_briefs set status = 'ready', plan = '{}', plan_hash = 'h1', review = '{\"ok\":true,\"reasons\":[]}' where id = $1", [brief]);
    const ap = idOf(await tool('propose_post', { accountId: xAccount, text: 'A video that changes after approval.', briefId: brief }));
    await sql("update video_briefs set plan_hash = 'h2' where id = $1", [brief]); // the plan changed after the approval was asked for
    const callsBefore = driverCalls.length;
    expect((await call('POST', `/approvals/${ap}/decide`, { approved: true })).status).toBe(200);
    await wait(async () => (await approval(ap)).status === 'failed');
    expect((await approval(ap)).result).toMatchObject({ reason: expect.stringMatching(/plan.*changed/i) });
    expect(driverCalls).toHaveLength(callsBefore); // what was approved is what would have gone out, and it is not
    await wait(async () => pushes().some((p) => p.title === PUSH_MESSAGES.executor_failed.title)); // that failure tells the phone too
  }, 60_000);

  it('(4) a failed publish is not retried, and tells the phone once', async () => {
    const before = pushes().filter((p) => p.title === PUSH_MESSAGES.executor_failed.title).length;
    driverMode = 'crash';
    const id = idOf(await tool('propose_post', { accountId: xAccount, text: 'This one will hit a crash in the browser.' }));
    expect((await call('POST', `/approvals/${id}/decide`, { approved: true })).status).toBe(200);
    await wait(async () => (await approval(id)).status === 'failed');
    await wait(async () => pushes().filter((p) => p.title === PUSH_MESSAGES.executor_failed.title).length > before);
    driverMode = 'ok';
    expect((await sql('select status from posts where approval_id = $1', [id])).rows[0].status).toBe('failed');
    expect(driverCalls.filter((c) => c.text.includes('hit a crash'))).toHaveLength(1);
    expect(pushes().filter((p) => p.title === PUSH_MESSAGES.executor_failed.title)).toHaveLength(before + 1);
    expect(pushes().every((p) => Object.keys(p).length === 4)).toBe(true);
  }, 60_000);
});
