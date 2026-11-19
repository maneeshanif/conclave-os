import { Hono } from 'hono';
import { z } from 'zod';
import { callOsTool, osTools, ToolError, type OsStore } from '../harness/os-tools';
import type { Breakers } from '../harness/breakers';
import type { RunTokens } from '../harness/run-tokens';

/**
 * The `os` MCP server over Streamable HTTP, stateless: every POST carries the run token and
 * gets a JSON answer. No SSE stream is offered, so GET answers 405, which the spec allows.
 */
const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST = SUPPORTED[0]!;

const RpcSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});
type Rpc = z.infer<typeof RpcSchema>;

const toolList = Object.entries(osTools).map(([name, t]) => {
  const schema = z.toJSONSchema(t.input, { io: 'input' }) as Record<string, unknown>;
  delete schema.$schema;
  return { name, minAutonomy: t.minAutonomy, description: t.description, inputSchema: schema };
});

function rpcError(id: Rpc['id'] | null, code: number, message: string) {
  return { jsonrpc: '2.0' as const, id: id ?? null, error: { code, message } };
}

export function mcpRoutes(deps: { tokens: RunTokens; store: OsStore; breakers?: Breakers }) {
  const r = new Hono();

  r.get('/', (c) => c.body(null, 405, { Allow: 'POST' }));
  r.delete('/', (c) => c.body(null, 405, { Allow: 'POST' }));

  r.post('/', async (c) => {
    const auth = c.req.header('authorization') ?? '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    const scope = deps.tokens.resolve(token);
    if (!scope) return c.json(rpcError(null, -32001, 'A valid run token is required.'), 401);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(rpcError(null, -32700, 'Parse error'), 400);
    }
    const batch = Array.isArray(body);
    const items = (batch ? body : [body]) as unknown[];
    const replies = [];
    for (const item of items) {
      const parsed = RpcSchema.safeParse(item);
      if (!parsed.success) {
        replies.push(rpcError(null, -32600, 'Invalid request'));
        continue;
      }
      const msg = parsed.data;
      if (msg.id === undefined) continue; // a notification, such as notifications/initialized
      replies.push(await handle(msg));
    }
    if (replies.length === 0) return c.body(null, 202);
    return c.json(batch ? replies : replies[0]);

    async function handle(msg: Rpc) {
      switch (msg.method) {
        case 'initialize': {
          const asked = typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : LATEST;
          return {
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: SUPPORTED.includes(asked) ? asked : LATEST,
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: 'conclave-os', version: '0.0.0' },
              instructions: 'Company tools for this run. They act only on your own task.',
            },
          };
        }
        case 'ping':
          return { jsonrpc: '2.0', id: msg.id, result: {} };
        case 'tools/list': {
          const level = await deps.store.autonomy(scope!);
          const list = scope!.trust === 'low' ? (scope!.allowedTools ?? []) : scope!.allowedTools;
          const tools = toolList.filter((t) => t.minAutonomy <= level && (!list || list.includes(t.name))).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
          return { jsonrpc: '2.0', id: msg.id, result: { tools } };
        }
        case 'tools/call': {
          const name = String(msg.params?.name ?? '');
          // Only real tools get a breaker (S3-6): a made-up name must not fill the table.
          const key = deps.breakers && name in osTools ? `os:${name}` : null;
          if (key && deps.breakers) {
            const gate = await deps.breakers.before(key);
            if (!gate.allowed) {
              const text = `The ${name} tool is temporarily unavailable: it failed several times in a row. It will be tried again after about ${gate.until.toISOString().slice(11, 16)} UTC. Carry on without it, or block your task and say it is unavailable.`;
              return { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }], isError: true } };
            }
          }
          try {
            const text = await callOsTool(deps.store, scope!, name, msg.params?.arguments);
            if (key) await deps.breakers?.success(key).catch(() => undefined);
            return { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }] } };
          } catch (err) {
            if (err instanceof ToolError) {
              // The tool worked and said no (a bad input, a refusal): not a failure of the tool.
              if (key) await deps.breakers?.success(key).catch(() => undefined);
              return { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: err.message }], isError: true } };
            }
            if (key) await deps.breakers?.failure(key, (err as Error).message).catch(() => undefined);
            return rpcError(msg.id, -32603, 'Internal error');
          }
        }
        default:
          return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
      }
    }
  });

  return r;
}
