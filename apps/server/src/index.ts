import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono, type Context } from 'hono';
import { serve as inngestServe } from 'inngest/hono';
import { createApp } from './app';
import { Bus } from './bus';
import { renderAll, renderOne } from './commands/agent-new';
import { createAuth, resolveAuthSecret } from './auth';
import { loadCompany } from './company/loader';
import { syncCompany } from './company/sync';
import { dispatchLimit, resolveAuthConfig, resolveLite, resolvePgPort } from './config';
import { singleFlight } from './workflows/single-flight';
import { ensureDailyBackup, type DailyState } from './backup';
import { ensureDailyBrief } from './brief/build';
import { DbOsStore } from './harness/db-os-store';
import { stopEverything } from './harness/kill-switch';
import { approvalHooks, createOutreach } from './outreach';
import { cancelAllRuns, executeRun, isRunActive, reapStaleRuns, type LoopDeps } from './harness/loop';
import { Breakers } from './harness/breakers';
import { ReaperStatus } from './health';
import { closeBudgetItems } from './harness/budget';
import { liftExpiredPauses } from './harness/pauses';
import { reapRuns } from './harness/reaper';
import { RunTokens } from './harness/run-tokens';
import { createCliRuntime } from './runtimes/cli';
import { createOpenAIAgentsRuntime } from './runtimes/openai-agents';
import { openSystem, ownerAccess } from './system';
import { LocalDispatcher, tick, type Dispatcher, type RunRequestEvent } from './workflows/dispatch';
import { createInngestGate, gateOps, LocalApprovalGate, type ApprovalGate } from './workflows/approval-gate';
import { createWorkflows } from './workflows/inngest';
import { runSequences } from './workflows/sequences';

const sys = await openSystem();

// The company folder is the source of truth for departments, goals, funnels and agents (SPEC 5): copy it into the
// database at start. A mistake in a file stops the server with the file and the reason, rather than running on stale rows.
{
  const synced = await syncCompany(sys.app, sys.workspace.id, await loadCompany(sys.companyRoot));
  console.log(`company synced: ${synced.departments} departments, ${synced.agents} agents, ${synced.funnels} funnels, ${synced.goals} goals`);
}
if (!sys.ownsDatabase) {
  console.error('Another Conclave server is already running on this DATA_DIR. Stop it first.');
  await sys.close();
  process.exit(1);
}
const bus = new Bus();
const tokens = new RunTokens();
// A proposal asks the approval gate to start waiting. The gate is built below, so this is bound late.
let proposalQueued: (workspaceId: string, approvalId: string) => void = () => undefined;
const store = new DbOsStore(
  sys.app,
  (workspaceId, taskId) => bus.publish({ kind: 'task.changed', workspaceId, taskId }),
  sys.companyRoot,
  (workspaceId, approvalId) => proposalQueued(workspaceId, approvalId),
);

// The email side: the transport (the outbox unless both real-sending settings are set) and the executors.
const { transport, executors } = createOutreach({
  pool: sys.app,
  workspaceId: sys.workspace.id,
  dataDir: sys.dataDir,
  companyRoot: sys.companyRoot,
  bus,
  env: process.env,
});
console.log(`email transport: ${transport.name}${transport.name === 'outbox' ? ` (files in ${path.join(sys.dataDir, 'outbox')}, nothing leaves this machine)` : ''}`);
if (!process.env.OUTREACH_FROM?.trim()) console.warn('OUTREACH_FROM is not set: approved emails will be refused until it is (see .env.example).');

// Every agent's working folder must match its role file before anything runs.
for (const r of await renderAll(sys)) console.log(`agent ${r.id}: ${r.runtime} folder ready`);
// Runs left running by a server that stopped are failed now and their tasks blocked with the reason.
const reaped = await reapStaleRuns(sys.app, sys.workspace.id);
if (reaped) console.log(`${reaped} run(s) from a previous server were marked failed`);

const loop: LoopDeps = {
  pool: sys.app,
  tokens,
  bus,
  runtimes: { 'claude-cli': createCliRuntime('claude-cli'), opencode: createCliRuntime('opencode'), 'openai-agents': createOpenAIAgentsRuntime({ osUrl: sys.osUrl }) },
  dataDir: sys.dataDir,
  workspaceSlug: sys.workspace.slug,
  templatesRoot: sys.templatesRoot,
  // A transient model error is retried after 5 seconds, 20 seconds and a minute, then once on the agent's fallback model (S3-2).
  retry: { delaysMs: [5_000, 20_000, 60_000] },
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
let gate: ApprovalGate;
// When the ticker last asked each agent, so an idle agent is not asked again every minute (S0-13).
const asked = new Map<string, Date>();
// Each minute: wake agents whose heartbeat is due (S0-13), and let the sequence runner make tasks for people whose next
// step is due (S2-5). The runner is idempotent, so running it every minute is cheap and safe.
const lite = resolveLite(); // LITE=1: one run at a time and no scheduled task overlapping itself (S3-10)
const runEveryMinute = async () => {
  const tz = process.env.COMPANY_TIMEZONE?.trim() || undefined; // schedules are read in the company's time zone; unset means this machine's
  const woken = await tick(sys.app, sys.workspace.id, dispatcher, new Date(), asked, tz ? { tz } : {});
  const briefTime = process.env.BRIEF_TIME?.trim() || '06:30'; // HH:MM in the company's time zone
  const brief = await ensureDailyBrief({ pool: sys.app, workspaceId: sys.workspace.id, tz, after: briefTime });
  if (brief) console.log(`morning brief for ${brief.day} is ready`);
  // The daily backup: a database dump beside the data, the last 14 kept, and a commit of the company folder (S3-9).
  const backed = await ensureDailyBackup({
    withOwner: ownerAccess(sys.dataDir, resolvePgPort()),
    pool: sys.app,
    workspaceId: sys.workspace.id,
    dataDir: sys.dataDir,
    companyRoot: sys.companyRoot,
    tz,
    after: process.env.BACKUP_TIME?.trim() || '02:30',
    state: backupState,
  });
  if (backed?.ok) console.log(`backup: wrote ${backed.file} (${backed.rows} rows)${backed.committed ? '; company folder committed' : ''}`);
  else if (backed) console.error(`backup failed: ${backed.error}`);
  // Runs whose process has gone quiet for good are failed and their tasks put back (S3-1). Nothing here needs a person.
  const reaped = await reapRuns({ pool: sys.app, workspaceId: sys.workspace.id, isActive: isRunActive });
  reaperStatus.record(reaped);
  for (const t of reaped.requeued) void dispatcher.request({ workspaceId: sys.workspace.id, agentId: t.agentId, trigger: 'task_assigned' });
  if (reaped.reaped.length) console.log(`reaper: failed ${reaped.reaped.length} silent run(s); ${reaped.requeued.length} task(s) put back, ${reaped.blocked.length} blocked`);
  // A runtime whose plan limit has reset is let go, and the agents with work waiting are woken (S3-3).
  const lifted = await liftExpiredPauses({ pool: sys.app, workspaceId: sys.workspace.id });
  for (const agentId of lifted.agentsWithWork) void dispatcher.request({ workspaceId: sys.workspace.id, agentId, trigger: 'task_assigned' });
  if (lifted.lifted.length) console.log(`plan limit reset: ${lifted.lifted.join(', ')} can run again`);
  // An agent that is back under its budget (a raised budget, a new month) is let go and woken if it has work (S3-4).
  const budgets = await closeBudgetItems({ pool: sys.app, workspaceId: sys.workspace.id });
  for (const agentId of budgets.agentsWithWork) void dispatcher.request({ workspaceId: sys.workspace.id, agentId, trigger: 'task_assigned' });
  const seq = await runSequences({ pool: sys.app, workspaceId: sys.workspace.id, bus });
  if (seq.created) console.log(`sequences: made ${seq.created} step task(s)`);
  return woken;
};
const everyMinute = lite ? singleFlight(runEveryMinute, [] as string[]) : runEveryMinute;
if (lite) console.log('lite mode: one run at a time');
if (useInngest) {
  const wf = createWorkflows({
    execute,
    tickAll: everyMinute,
    approvals: gateOps({ pool: sys.app, workspaceId: sys.workspace.id, bus, executors }),
    lite,
  });
  dispatcher = wf.dispatcher;
  gate = createInngestGate({ send: (e) => wf.inngest.send(e), pool: sys.app, workspaceId: sys.workspace.id, bus, executors });
  inngestHandler = inngestServe({ client: wf.inngest, functions: wf.functions });
} else {
  dispatcher = new LocalDispatcher(execute, dispatchLimit());
  gate = new LocalApprovalGate({ pool: sys.app, workspaceId: sys.workspace.id, bus, executors });
  ticker = setInterval(
    () => void everyMinute().catch((err) => console.error('ticker:', err)),
    60_000,
  );
}

const hooks = approvalHooks(gate);
proposalQueued = hooks.onApprovalRequested;

// Where to listen and whether a login is needed. Throws, before anything listens, if the server would be open to the network.
const authConfig = resolveAuthConfig(process.env);
const auth = authConfig.login ? createAuth({ pool: sys.app, workspaceId: sys.workspace.id, config: authConfig, dataDir: sys.dataDir, secret: resolveAuthSecret(process.env, sys.dataDir) }) : undefined;
if (auth) {
  const setup = await auth.ensureSetupCode();
  if (setup.file) console.log(`login is on and there is no owner yet. The one-time setup code is in ${setup.file} (valid 15 minutes, used once). Open ${authConfig.webOrigin}/login to finish.`);
  else console.log(`login is on (passkeys). Sign in at ${authConfig.webOrigin}/login`);
} else {
  console.log('login is off: the server answers on this laptop only (loopback)');
}

const reaperStatus = new ReaperStatus();
const backupState: DailyState = {};
const breakers = new Breakers({ pool: sys.app, workspaceId: sys.workspace.id });

const shell = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app: shell });
shell.route(
  '/',
  createApp({
    pool: sys.app,
    workspaceId: sys.workspace.id,
    tokens,
    store,
    breakers,
    reaperStatus,
    bus,
    dispatcher,
    upgradeWebSocket,
    hosts: [`127.0.0.1:${sys.serverPort}`, `localhost:${sys.serverPort}`, new URL(authConfig.apiOrigin).host, `${authConfig.host}:${sys.serverPort}`],
    ...(auth ? { auth } : {}),
    onApprovalDecided: hooks.onApprovalDecided,
    onCompanyReload: async () => {
      const synced = await syncCompany(sys.app, sys.workspace.id, await loadCompany(sys.companyRoot));
      return { departments: synced.departments, agents: synced.agents, funnels: synced.funnels, goals: synced.goals };
    },
    onReleaseHeld: hooks.onReleaseHeld,
    // Turning the kill switch on stops what is running and drops what is queued (S1-5).
    onKillSwitch: async (on) => {
      if (!on) return;
      const { dropped, cancelled } = await stopEverything(dispatcher);
      console.log(`kill switch on: cancelled ${cancelled} run(s), dropped ${dropped} queued request(s)`);
    },
    ...(inngestHandler ? { inngestHandler } : {}),
  }),
);

// What was decided while the server was down is sent now, once; what is still pending waits again (SPEC 6).
{
  const r = await gate.recover();
  if (r.waiting.length || r.expired.length || r.resumed.length || r.unknown.length || r.held.length) {
    console.log(
      `approvals: ${r.waiting.length} waiting, ${r.expired.length} expired, ${r.resumed.length - r.held.length} sent, ${r.held.length} held for a send cap, ${r.unknown.length} left mid-send by the last run (not resent)`,
    );
  }
}

const server = serve({ fetch: shell.fetch, port: sys.serverPort, hostname: authConfig.host }, (info) => {
  console.log(`conclave server listening on http://${authConfig.host}:${info.port} (workflows: ${dispatcher.name})`);
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
  if (gate instanceof LocalApprovalGate) gate.stop();
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
