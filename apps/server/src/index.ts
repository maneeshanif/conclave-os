import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono, type Context } from 'hono';
import { serve as inngestServe } from 'inngest/hono';
import { createApp } from './app';
import { Bus } from './bus';
import { renderAll, renderOne } from './commands/agent-new';
import { HOST } from './config';
import { DbOsStore } from './harness/db-os-store';
import { cancelAllRuns, executeRun, reapStaleRuns, type LoopDeps } from './harness/loop';
import { RunTokens } from './harness/run-tokens';
import { createCliRuntime } from './runtimes/cli';
import { openSystem } from './system';
import { LocalDispatcher, tick, type Dispatcher, type RunRequestEvent } from './workflows/dispatch';
import { createWorkflows } from './workflows/inngest';

const sys = await openSystem();
if (!sys.ownsDatabase) {
  console.error('Another Conclave server is already running on this DATA_DIR. Stop it first.');
  await sys.close();
  process.exit(1);
}
const bus = new Bus();
const tokens = new RunTokens();
const store = new DbOsStore(sys.app, (workspaceId, taskId) => bus.publish({ kind: 'task.changed', workspaceId, taskId }));

// Every agent's working folder must match its role file before anything runs.
for (const r of await renderAll(sys)) console.log(`agent ${r.id}: ${r.runtime} folder ready`);
// Runs left running by a server that stopped are failed now and their tasks blocked with the reason.
const reaped = await reapStaleRuns(sys.app, sys.workspace.id);
if (reaped) console.log(`${reaped} run(s) from a previous server were marked failed`);

const loop: LoopDeps = {
  pool: sys.app,
  tokens,
  bus,
  runtimes: { 'claude-cli': createCliRuntime('claude-cli'), opencode: createCliRuntime('opencode') },
  dataDir: sys.dataDir,
  workspaceSlug: sys.workspace.slug,
  templatesRoot: sys.templatesRoot,
  prepare: (agentKey) => renderOne(sys, agentKey),
};
const execute = (e: RunRequestEvent) => executeRun(loop, e.workspaceId, e.agentId, e.trigger);

/**
 * Workflows run on Inngest when its dev server or a cloud key is configured (SPEC 11), and otherwise on
 * the in-process dispatcher with the same limits, so the OS works with nothing else installed.
 */
const useInngest = !!(process.env.INNGEST_DEV || process.env.INNGEST_BASE_URL || process.env.INNGEST_EVENT_KEY);
let dispatcher: Dispatcher;
let inngestHandler: ((c: Context) => Promise<Response>) | undefined;
let ticker: NodeJS.Timeout | undefined;
// When the ticker last asked each agent, so an idle agent is not asked again every minute (S0-13).
const asked = new Map<string, Date>();
if (useInngest) {
  const wf = createWorkflows({ execute, tickAll: () => tick(sys.app, sys.workspace.id, dispatcher, new Date(), asked) });
  dispatcher = wf.dispatcher;
  inngestHandler = inngestServe({ client: wf.inngest, functions: wf.functions });
} else {
  dispatcher = new LocalDispatcher(execute);
  ticker = setInterval(
    () => void tick(sys.app, sys.workspace.id, dispatcher, new Date(), asked).catch((err) => console.error('ticker:', err)),
    60_000,
  );
}

const shell = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app: shell });
shell.route(
  '/',
  createApp({
    pool: sys.app,
    workspaceId: sys.workspace.id,
    tokens,
    store,
    bus,
    dispatcher,
    upgradeWebSocket,
    hosts: [`127.0.0.1:${sys.serverPort}`, `localhost:${sys.serverPort}`],
    ...(inngestHandler ? { inngestHandler } : {}),
  }),
);

const server = serve({ fetch: shell.fetch, port: sys.serverPort, hostname: HOST }, (info) => {
  console.log(`conclave server listening on http://${HOST}:${info.port} (workflows: ${dispatcher.name})`);
});
injectWebSocket(server);
// `pnpm doctor` reads this to report the server's memory (SPEC 17).
const pidFile = path.join(sys.dataDir, 'server.pid');
writeFileSync(pidFile, String(process.pid));

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (ticker) clearInterval(ticker);
  const n = await cancelAllRuns();
  if (n) console.log(`cancelled ${n} run(s)`);
  // Give the cancelled runs a moment to write their final state.
  if (n) await new Promise((r) => setTimeout(r, 2000));
  server.close();
  rmSync(pidFile, { force: true });
  await sys.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
