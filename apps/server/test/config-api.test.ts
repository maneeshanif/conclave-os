import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { HAND_DECISIONS_NEEDED } from '../src/approvals/delegate';
import { Bus } from '../src/bus';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool, MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

/** The Settings screen's API: what was only SQL or code before is set from the front end. */
let sys: System;
let app: ReturnType<typeof createApp>;
let dataDir = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const json = { 'content-type': 'application/json' };
const call = (method: string, url: string, body?: unknown) => app.request(url, { method, headers: json, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
type Config = { hiring: { level: string; rosterCap: number }; guestLinkHours: number; agents: { key: string; selfWriting: boolean; autonomy: number }[]; delegate: { registered: boolean; active: boolean; fingerprint: string | null; mandate: Record<string, unknown>; handDecisions: Record<string, number>; handDecisionsNeeded: number }; connectors: { git: string; meeting: string; claudeAgentKey: string } };
const config = async () => (await (await call('GET', '/api/config')).json()) as Config;

beforeAll(async () => {
  ({ sys } = await testSystem());
  dataDir = await mkdtemp(path.join(tmpdir(), 'conclave-cfg-'));
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'cfg-r', name: 'Cora' });
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), dataDir });
}, 240_000);
afterAll(async () => {
  await sys?.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

describe('GET /api/config (Settings)', () => {
  it('gathers what can be changed, shows connectors by name and a key only as set or not set, and holds no secret', async () => {
    process.env.CLAUDE_AGENT_API_KEY = 'sk-ant-should-never-appear';
    try {
      const text = await (await call('GET', '/api/config')).text();
      expect(text).not.toContain('sk-ant-should-never-appear');
      const c = JSON.parse(text) as Config;
      expect(c.connectors).toMatchObject({ git: 'local', meeting: 'local', claudeAgentKey: 'set' });
      expect(c.hiring).toMatchObject({ level: 'H0', rosterCap: 20 });
      expect(c.guestLinkHours).toBe(48);
      expect(c.agents.find((a) => a.key === 'cfg-r')).toMatchObject({ selfWriting: false });
      expect(c.delegate).toMatchObject({ registered: false, active: false, handDecisionsNeeded: HAND_DECISIONS_NEEDED });
    } finally {
      delete process.env.CLAUDE_AGENT_API_KEY;
    }
  });
});

describe('agents (Settings)', () => {
  it('switches self-writing and the autonomy level, records it, and refuses a level out of range or an unknown field', async () => {
    expect((await call('PUT', '/api/config/agents/cfg-r', { selfWriting: true, autonomy: 2 })).status).toBe(200);
    expect((await config()).agents.find((a) => a.key === 'cfg-r')).toMatchObject({ selfWriting: true, autonomy: 2 });
    expect((await sql("select count(*)::int as n from audit_log where action = 'config.agent' and subject = 'cfg-r'")).rows[0].n).toBe(1);
    expect((await call('PUT', '/api/config/agents/cfg-r', { autonomy: 4 })).status).toBe(400);
    expect((await call('PUT', '/api/config/agents/cfg-r', { status: 'active' })).status).toBe(400);
    expect((await call('PUT', '/api/config/agents/cfg-r', {})).status).toBe(400);
    expect((await call('PUT', '/api/config/agents/nobody', { selfWriting: true })).status).toBe(404);
  });
});

describe('guest link hours (Settings)', () => {
  it('is saved within limits, and is the default a proposed invite uses', async () => {
    expect((await call('PUT', '/api/config/guest-link-hours', { hours: 500 })).status).toBe(400);
    expect((await call('PUT', '/api/config/guest-link-hours', { hours: 12 })).status).toBe(200);
    expect((await config()).guestLinkHours).toBe(12);
    const agentId = (await sql("select id from agents where key = 'cfg-r'")).rows[0].id as string;
    const runId = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status) values ($1, $2, 'task', 'claude-cli', 'running') returning id", [ws(), agentId])).rows[0].id as string;
    const meeting = (await sql("insert into meetings (workspace_id, title, starts_at) values ($1, 'M', now()) returning id", [ws()])).rows[0].id as string;
    await callOsTool(new DbOsStore(sys.app, () => undefined, sys.companyRoot), { workspaceId: ws(), agentId, runId }, 'propose_meeting', { meetingId: meeting, to: 'a@b.test' });
    expect((await sql("select payload from approvals where kind = 'meeting.invite'")).rows[0].payload.ttlHours).toBe(12);
  });
});

describe('the delegate (Settings)', () => {
  it('is registered once, off, with a fingerprint and no key shown', async () => {
    const r = await call('POST', '/api/config/delegate/register');
    expect(r.status).toBe(201);
    const text = JSON.stringify(await config());
    expect(text).not.toContain('PRIVATE KEY');
    const c = await config();
    expect(c.delegate).toMatchObject({ registered: true, active: false });
    expect(c.delegate.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect((await call('POST', '/api/config/delegate/register')).status).toBe(409);
  });

  it('takes a mandate rule only after twenty decisions by hand, and then can be switched on, narrowed, and revoked', async () => {
    const rule = { kind: 'email.send', minStep: 2, maxStep: 3 };
    const early = await call('PUT', '/api/config/delegate/mandate', rule);
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: string }).error).toMatch(new RegExp(String(HAND_DECISIONS_NEEDED)));
    for (let i = 0; i < HAND_DECISIONS_NEEDED; i++) await sql("insert into approvals (workspace_id, kind, dedupe_key, payload, status, decided_by) values ($1, 'email.send', $2, '{}', 'executed', 'founder')", [ws(), `cfg-hand:${randomUUID()}`]);
    expect((await config()).delegate.handDecisions['email.send']).toBeGreaterThanOrEqual(HAND_DECISIONS_NEEDED);
    expect((await call('PUT', '/api/config/delegate/mandate', rule)).status).toBe(200);
    expect((await call('PUT', '/api/config/delegate/mandate', { ...rule, kind: 'hire' })).status).toBe(400);
    expect((await call('PUT', '/api/config/delegate/mandate', { ...rule, minStep: 5, maxStep: 3 })).status).toBe(400);
    expect((await config()).delegate.mandate['email.send']).toMatchObject({ minStep: 2, maxStep: 3 });
    expect((await call('PUT', '/api/config/delegate/active', { active: true })).status).toBe(200);
    expect((await config()).delegate.active).toBe(true);
    expect((await call('DELETE', '/api/config/delegate/mandate/email.send')).status).toBe(200);
    expect((await config()).delegate.mandate).toEqual({});
    expect((await call('POST', '/api/config/delegate/revoke')).status).toBe(200);
    expect((await config()).delegate).toMatchObject({ active: false, revoked: true });
    expect((await call('PUT', '/api/config/delegate/active', { active: true })).status).toBe(409);
  });
});

describe('the tool call log (Settings)', () => {
  it('lists recent calls with who made them and what was decided', async () => {
    const agentId = (await sql("select id from agents where key = 'cfg-r'")).rows[0].id as string;
    await sql("insert into tool_calls (workspace_id, agent_id, tool, risk, decision, reason) values ($1, $2, 'send_email', 'unknown', 'refused', 'no such tool')", [ws(), agentId]);
    const calls = ((await (await call('GET', '/api/config/tool-calls?limit=5')).json()) as { calls: { tool: string; decision: string; agent: string; reason: string }[] }).calls;
    expect(calls[0]).toMatchObject({ tool: 'send_email', decision: 'refused', agent: 'cfg-r', reason: 'no such tool' });
  });
});

describe('spend corrections (Settings, A5)', () => {
  it('are added with a reason, counted in the month, audit-logged, and refused when empty or without a reason', async () => {
    const ok = await call('POST', '/api/config/agents/cfg-r/spend', { usd: -2.5, reason: 'The CLI double counted a run' });
    expect(ok.status).toBe(201);
    expect(Number((await sql("select usd from spend_adjustments where reason like 'The CLI%'")).rows[0].usd)).toBe(-2.5);
    expect((await sql("select count(*)::int as n from audit_log where action = 'config.spend_adjustment'")).rows[0].n).toBe(1);
    expect((await call('POST', '/api/config/agents/cfg-r/spend', { usd: 0, reason: 'nothing' })).status).toBe(400);
    expect((await call('POST', '/api/config/agents/cfg-r/spend', { usd: 3, reason: '' })).status).toBe(400);
    expect((await call('POST', '/api/config/agents/nobody/spend', { usd: 3, reason: 'who' })).status).toBe(404);
  });
});

describe('PUT /api/config/connectors (switch with no restart)', () => {
  it('switches the code host and the meetings connector, is used at once, keeps only names, and refuses an unknown one', async () => {
    const before = (await config()) as unknown as { connectors: { git: string; meeting: string; options: Record<string, string[]> } };
    expect(before.connectors.options).toEqual({ git: ['local', 'gh'], meeting: ['local', 'livekit'] });
    const ok = await call('PUT', '/api/config/connectors', { meeting: 'livekit' });
    expect(ok.status).toBe(200);
    expect(((await config()) as unknown as { connectors: { meeting: string; git: string } }).connectors).toMatchObject({ meeting: 'livekit', git: 'local' });
    // The connector in use is read each time: the livekit stand-in refuses with its own message, so the switch took effect.
    const { SwitchableMeeting } = await import('../src/connectors/choice');
    await expect(new SwitchableMeeting(sys.app, ws(), undefined).createRoom({ meetingId: 'm1', title: 't' })).rejects.toThrow(/LiveKit is not set up/);
    expect((await call('PUT', '/api/config/connectors', { meeting: 'local' })).status).toBe(200);
    await expect(new SwitchableMeeting(sys.app, ws(), undefined).createRoom({ meetingId: 'm1', title: 't' })).resolves.toEqual({ room: 'local-m1' });
    const bad = await call('PUT', '/api/config/connectors', { git: 'bitbucket' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/local, gh/);
    expect((await call('PUT', '/api/config/connectors', {})).status).toBe(400);
    expect((await call('PUT', '/api/config/connectors', { git: 'local', key: 'sk-secret' })).status).toBe(400); // nothing but names
    const kept = (await sql('select connectors from workspace_settings')).rows[0].connectors as Record<string, string>;
    expect(Object.values(kept).every((v) => ['local', 'gh', 'livekit'].includes(v))).toBe(true);
    const logged = (await sql("select data from audit_log where action = 'config.connectors'")).rows;
    expect(logged.length).toBe(2);
  });
describe('PUT /api/config/agents/:key (the stack)', () => {
  it('changes the runtime and model of an agent when they work together, and refuses a pair that does not, an unknown name, and a missing agent', async () => {
    const before = (await config()) as unknown as { stack: { runtimes: string[]; models: { name: string; on: string[]; remote: boolean }[] } };
    expect(before.stack.runtimes).toContain('openai-agents');
    expect(before.stack.models.find((m) => m.name === 'openai')).toMatchObject({ on: ['openai-agents'], remote: true });
    const ok = await call('PUT', '/api/config/agents/cfg-r', { runtime: 'openai-agents', modelAlias: 'local-worker' });
    expect(ok.status).toBe(200);
    expect(((await config()) as unknown as { agents: { key: string; runtime: string; modelAlias: string }[] }).agents.find((a) => a.key === 'cfg-r')).toMatchObject({ runtime: 'openai-agents', modelAlias: 'local-worker' });
    const mismatch = await call('PUT', '/api/config/agents/cfg-r', { modelAlias: 'writer' }); // writer runs on claude-cli and claude-agent, not openai-agents
    expect(mismatch.status).toBe(400);
    expect(((await mismatch.json()) as { error: string }).error).toMatch(/does not run on openai-agents/);
    expect((await call('PUT', '/api/config/agents/cfg-r', { runtime: 'nope' })).status).toBe(400);
    expect((await call('PUT', '/api/config/agents/cfg-r', { modelAlias: 'nope' })).status).toBe(400);
    expect((await call('PUT', '/api/config/agents/missing', { runtime: 'claude-cli' })).status).toBe(404);
    const still = ((await config()) as unknown as { agents: { key: string; runtime: string; modelAlias: string }[] }).agents.find((a) => a.key === 'cfg-r')!;
    expect(still).toMatchObject({ runtime: 'openai-agents', modelAlias: 'local-worker' }); // a refusal changed nothing
  });
});

describe('low trust (P4)', () => {
  it('switches an agent to low trust, which also switches its self-writing off, and refuses an unknown level', async () => {
    await call('PUT', '/api/config/agents/cfg-r', { selfWriting: true });
    expect((await call('PUT', '/api/config/agents/cfg-r', { trust: 'low' })).status).toBe(200);
    const a = ((await config()) as unknown as { agents: { key: string; trust: string; selfWriting: boolean }[] }).agents.find((x) => x.key === 'cfg-r')!;
    expect(a).toMatchObject({ trust: 'low', selfWriting: false });
    expect((await call('PUT', '/api/config/agents/cfg-r', { trust: 'paranoid' })).status).toBe(400);
    expect((await call('PUT', '/api/config/agents/cfg-r', { trust: 'standard' })).status).toBe(200);
  });
});

describe('diagnostics', () => {
  it('reports keys only as set or not set, never a value, and lists an agent whose folder failed its check', async () => {
    const { keyStatuses } = await import('../src/diagnostics');
    const k = keyStatuses({ RESEND_API_KEY: 're_secret_value', OPENAI_API_KEY: '   ', OUTREACH_FROM: 'a@b.c' });
    expect(k.find((x) => x.name === 'RESEND_API_KEY')).toMatchObject({ set: true, usedByCode: true });
    expect(k.find((x) => x.name === 'OPENAI_API_KEY')!.set).toBe(false); // blank is not set
    expect(k.find((x) => x.name === 'LIVEKIT_API_KEY')).toMatchObject({ set: false, usedByCode: false });
    expect(JSON.stringify(k)).not.toContain('re_secret_value');
    await sql("insert into agent_probes (workspace_id, agent_id, ok, problems) select $1, id, false, '[\"AGENT.md is missing\"]'::jsonb from agents where key = 'cfg-r'", [ws()]);
    const d = ((await config()) as unknown as { diagnostics: { node: string; keys: { name: string }[]; failedProbes: { key: string; problems: string[] }[] } }).diagnostics;
    expect(d.node).toBe(process.version);
    expect(d.keys.length).toBeGreaterThan(5);
    expect(d.failedProbes).toEqual([{ key: 'cfg-r', problems: ['AGENT.md is missing'] }]);
    await sql("delete from agent_probes where agent_id in (select id from agents where key = 'cfg-r')");
  });
});

describe('PUT /api/config/embedded-tools', () => {
  it('keeps a clean allow-list, shows it in the config, and refuses an address that is not a public https page', async () => {
    const ok = await call('PUT', '/api/config/embedded-tools', { tools: [{ name: 'Notion', url: 'https://www.notion.so/team' }] });
    expect(ok.status).toBe(200);
    expect(((await config()) as unknown as { embeddedTools: unknown[] }).embeddedTools).toEqual([{ name: 'Notion', url: 'https://www.notion.so/team' }]);
    for (const url of ['http://notion.so', 'https://localhost', 'https://127.0.0.1', 'javascript:alert(1)']) {
      const bad = await call('PUT', '/api/config/embedded-tools', { tools: [{ name: 'X', url }] });
      expect(bad.status, url).toBe(400);
    }
    expect((await call('PUT', '/api/config/embedded-tools', {})).status).toBe(400);
    expect(((await config()) as unknown as { embeddedTools: unknown[] }).embeddedTools).toHaveLength(1); // a refusal changed nothing
    expect((await call('PUT', '/api/config/embedded-tools', { tools: [] })).status).toBe(200);
  });
});

});
