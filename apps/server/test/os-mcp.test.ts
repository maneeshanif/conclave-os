import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { mcpRoutes } from '../src/routes/mcp';

interface RpcReply {
  result: {
    protocolVersion: string;
    capabilities: { tools?: unknown };
    tools: { name: string; inputSchema: { type: string } }[];
    content: { text: string }[];
    isError?: boolean;
  };
}
const json = async (res: Response | Promise<Response>) => (await (await res).json()) as RpcReply;

function setup() {
  const tokens = new RunTokens();
  const store = new MemoryOsStore();
  store.tasks.set('task-a', { id: 'task-a', workspaceId: 'ws1', title: 'Task A', body: 'Do A', status: 'in_progress' });
  store.tasks.set('task-b', { id: 'task-b', workspaceId: 'ws1', title: 'Task B', body: 'Do B', status: 'in_progress' });
  const app = new Hono().route('/mcp', mcpRoutes({ tokens, store }));
  const tokA = tokens.issue({ workspaceId: 'ws1', agentId: 'agent-1', runId: 'run-a', taskId: 'task-a' });
  const tokB = tokens.issue({ workspaceId: 'ws1', agentId: 'agent-2', runId: 'run-b', taskId: 'task-b' });
  const rpc = (token: string | null, method: string, params?: unknown, id: number | null = 1) =>
    app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) }),
    });
  return { tokens, store, rpc, tokA, tokB, app };
}

describe('the os MCP server (S0-5)', () => {
  it('refuses a call with no token', async () => {
    const { rpc } = setup();
    const res = await rpc(null, 'tools/list');
    expect(res.status).toBe(401);
  });

  it('refuses an unknown or revoked token', async () => {
    const { rpc, tokens, tokA } = setup();
    expect((await rpc('crt_madeup', 'tools/list')).status).toBe(401);
    tokens.revokeRun('run-a');
    expect((await rpc(tokA, 'tools/list')).status).toBe(401);
  });

  it('expires tokens', async () => {
    let now = 1_000;
    const tokens = new RunTokens(() => now);
    const t = tokens.issue({ workspaceId: 'w', agentId: 'a', runId: 'r' }, 1000);
    expect(tokens.resolve(t)).not.toBeNull();
    now += 1001;
    expect(tokens.resolve(t)).toBeNull();
  });

  it('speaks enough MCP for a client: initialize, notifications, tools/list', async () => {
    const { rpc, tokA } = setup();
    const init = await json(rpc(tokA, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }));
    expect(init.result.protocolVersion).toBe('2025-06-18');
    expect(init.result.capabilities.tools).toBeDefined();
    expect((await rpc(tokA, 'notifications/initialized', undefined, null)).status).toBe(202);
    const list = await json(rpc(tokA, 'tools/list'));
    expect(list.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(['ask_founder', 'block_task', 'comment', 'complete_task', 'get_brief', 'get_deal', 'get_lead', 'get_task']);
    expect(list.result.tools[0]?.inputSchema.type).toBe('object');
  });

  it('acts only on the run’s own task: another run’s token cannot touch it', async () => {
    const { rpc, store, tokA, tokB } = setup();
    const got = await json(rpc(tokA, 'tools/call', { name: 'get_task', arguments: {} }));
    expect(got.result.content[0]?.text).toContain('Task A');
    expect(got.result.content[0]?.text).not.toContain('Task B');

    await rpc(tokB, 'tools/call', { name: 'complete_task', arguments: { output: 'B done' } });
    expect(store.tasks.get('task-a')?.status).toBe('in_progress');
    expect(store.tasks.get('task-b')?.status).toBe('done');
  });

  it('validates tool input and reports tool errors as tool results', async () => {
    const { rpc, tokA } = setup();
    const bad = await json(rpc(tokA, 'tools/call', { name: 'comment', arguments: { text: '' } }));
    expect(bad.result.isError).toBe(true);
    const unknown = await json(rpc(tokA, 'tools/call', { name: 'send_email', arguments: {} }));
    expect(unknown.result.isError).toBe(true);
  });

  it('hides and refuses propose_email below autonomy 2, and lists it at 2', async () => {
    const { rpc, tokA, store } = setup();
    const hidden = await json(rpc(tokA, 'tools/list'));
    expect(hidden.result.tools.map((t) => t.name)).not.toContain('propose_email');
    const refused = await json(rpc(tokA, 'tools/call', { name: 'propose_email', arguments: {} }));
    expect(refused.result.isError).toBe(true);
    store.autonomyLevel = 2;
    const shown = await json(rpc(tokA, 'tools/list'));
    expect(shown.result.tools.map((t) => t.name)).toContain('propose_email');
  });

  it('ask_founder blocks the task with the question', async () => {
    const { rpc, store, tokA } = setup();
    await rpc(tokA, 'tools/call', { name: 'ask_founder', arguments: { question: 'Which city?' } });
    expect(store.tasks.get('task-a')).toMatchObject({ status: 'blocked' });
    expect(store.messages.at(-1)).toMatchObject({ to: 'founder', body: 'Which city?' });
  });
});
