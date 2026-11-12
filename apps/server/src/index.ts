import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { serve as inngestServe } from 'inngest/hono';
import { Hono } from 'hono';
import { createApp } from './app';
import { Bus } from './bus';
import { renderAll } from './commands/agent-new';
import { HOST } from './config';
import { DbOsStore } from './harness/db-os-store';
import { executeRun, type LoopDeps } from './harness/loop';
import { RunTokens } from './harness/run-tokens';
import { createCliRuntime } from './runtimes/cli';
import { openSystem } from './system';
import { LocalDispatcher, tick, type Dispatcher, type RunRequestEvent } from './workflows/dispatch';
import { createWorkflows } from './workflows/inngest';

const sys = await openSystem(process.env, (m) => console.log(m));
const bus = new Bus();
const tokens = new RunTokens();
const store = new DbOsStore(sys.app, (workspaceId, taskId) => bus.publish({ kind: 'task.changed', workspaceId, taskId }));

// Make sure every agent's working folder matches its role file before anything runs.
for (const r of await renderAll(sys)) console.log(`agent ${r.id}: ${r.runtime} folder ready`);

const loop: LoopDeps = {
  pool: sys.app,
  tokens,
  bus,
  runtimes: { 'claude-cli': createCliRuntime('claude-cli'), opencode: createCliRuntime('opencode') },
  dataDir: sys.dataDir,
  workspaceSlug: sys.workspace.slug,
  templatesRoot: sys.templatesRoot,
};
const execute = (e: RunRequestEvent) => executeRun(loop, e.workspaceId, e.agentId, e.trigger);

/**
 * Workflows run on Inngest when its dev server (or a cloud key) is configured, and otherwise on the
 * in-process dispatcher with the same limits, so the OS works with nothing else installed.
 */
const useInngest = !!(process.env.INNGEST_DEV || process.env.INNGEST_BASE_URL || process.env.INNGEST_EVENT_KEY);
let dispatcher: Dispatcher;
let inngestHandler: ((c: import('hono').Context) => Promise<Response>) | undefined;
let ticker: NodeJS.Timeout | undefined;
if (useInngest) {
  const wf = createWorkflows({ execute, tickAll: () => tick(sys.app, sys.workspace.id, dispatcher) });
  dispatcher = wf.dispatcher;
  inngestHandler = inngestServe({ client: wf.inngest, functions: wf.functions });
} else {
  dispatcher = new LocalDispatcher(execute);
  ticker = setInterval(() => void tick(sys.app, sys.workspace.id, dispatcher).catch((err) => console.error('ticker:', err)), 60_000);
}

const shell = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app: shell });
const app = createApp({
  pool: sys.app,
  workspaceId: sys.workspace.id,
  tokens,
  store,
  bus,
  dispatcher,
  upgradeWebSocket,
  ...(inngestHandler ? { inngestHandler } : {}),
});
shell.route('/', app);

const server = serve({ fetch: shell.fetch, port: sys.serverPort, hostname: HOST }, (info) => {
  console.log(`conclave server listening on http://${HOST}:${info.port} (workflows: ${dispatcher.name})`);
});
injectWebSocket(server);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (ticker) clearInterval(ticker);
  server.close();
  await sys.close();
  process.exit(0);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
