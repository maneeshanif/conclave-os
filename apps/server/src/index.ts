import { rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono, type Context } from 'hono';
import { Companies } from './companies';
import { CompanyRuntimes, runCompanyMinute } from './company-runtime';
import { serve as inngestServe } from 'inngest/hono';
import { createApp } from './app';
import { Bus } from './bus';
import { agentNew, renderAll } from './commands/agent-new';
import { createAuth, resolveAuthSecret } from './auth';
import { loadCompany } from './company/loader';
import { syncCompany } from './company/sync';
import { dispatchLimit, resolveAuthConfig, resolveLite, resolvePgPort } from './config';
import { singleFlight } from './workflows/single-flight';
import { ensureDailyBackup, type DailyState } from './backup';
import { attachOfficeEvents } from './office/live';
import { createNotifier, ensureVapidKeys, webPushSender } from './push';
import { DbOsStore } from './harness/db-os-store';
import { stopEverything } from './harness/kill-switch';
import { createOutreach } from './outreach';
import { cancelAllRuns, executeRun, isRunActive, reapStaleRuns, type LoopDeps } from './harness/loop';
import { Breakers } from './harness/breakers';
import { ReaperStatus } from './health';
import { RunTokens } from './harness/run-tokens';
import { createCliRuntime } from './runtimes/cli';
import { createHttpRuntime } from './runtimes/http';
import { createOpenAIAgentsRuntime } from './runtimes/openai-agents';
import { companyName, openSystem, ownerAccess } from './system';
import { LocalDispatcher, type Dispatcher, type RunRequestEvent } from './workflows/dispatch';
import { createInngestGate, gateOps, LocalApprovalGate, type ApprovalGate } from './workflows/approval-gate';
import { createWorkflows } from './workflows/inngest';

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
// Every company on the list (S6-13a). Each has its own executors, approval gate, run loop view and scheduled work (S6-13e).
const companies = new Companies({ dataDir: sys.dataDir, templatesRoot: sys.templatesRoot, pool: sys.app, defaultCompany: { id: sys.workspace.id, slug: sys.workspace.slug, root: sys.companyRoot } });
const runtimes = new CompanyRuntimes({ sys, companies, bus, env: process.env });
// A proposal asks the approval gate to start waiting. The gate is built below, so this is bound late.
let proposalQueued: (workspaceId: string, approvalId: string) => void = () => undefined;
const store = new DbOsStore(
  sys.app,
  (workspaceId, taskId) => bus.publish({ kind: 'task.changed', workspaceId, taskId }),
  // The folder of the company a run belongs to, for the blocked-claims check on its proposals.
  (workspaceId) => runtimes.rootFor(workspaceId),
  (workspaceId, approvalId) => proposalQueued(workspaceId, approvalId),
  // A handoff moves an agent in the office (S6-13d2).
  (workspaceId) => bus.publish({ kind: 'office.changed', workspaceId }),
  sys.templatesRoot,
);

// The email side: the transport (the outbox unless both real-sending settings are set) and the executors.
const { transport, executors } = createOutreach({
  pool: sys.app,
  workspaceId: sys.workspace.id,
  dataDir: sys.dataDir,
  companyRoot: sys.companyRoot,
  bus,
  env: process.env,
  agentFactory: (o) => agentNew(sys, o),
});
console.log(`email transport: ${transport.name}${transport.name === 'outbox' ? ` (files in ${path.join(sys.dataDir, 'outbox')}, nothing leaves this machine)` : ''}`);
if (!process.env.OUTREACH_FROM?.trim()) console.warn('OUTREACH_FROM is not set: approved emails will be refused until it is (see .env.example).');

// Every agent's working folder must match its role file before anything runs.
for (const r of await renderAll(sys)) console.log(`agent ${r.id}: ${r.runtime} folder ready`);
// Runs left running by a server that stopped are failed now and their tasks blocked with the reason.
const reaped = await reapStaleRuns(sys.app, sys.workspace.id);
if (reaped) console.log(`${reaped} run(s) from a previous server were marked failed`);

// Workers for the http runtime (S9-1): HTTP_WORKERS is a JSON map from an agent key (or "*") to an address, on this machine unless HTTP_ALLOW_REMOTE=1.
const workerMap: Record<string, string> = (() => {
  try {
    return JSON.parse(process.env.HTTP_WORKERS ?? '{}') as Record<string, string>;
  } catch {
    console.error('HTTP_WORKERS is not valid JSON, so no http worker is set up.');
    return {};
  }
})();
const workerUrl = (req: { agentKey: string }) => workerMap[req.agentKey] ?? workerMap['*'];
const readStanding = (req: { workspaceDir: string }) => readFile(path.join(req.workspaceDir, 'INSTRUCTIONS.md'), 'utf8');

const loopBase: Omit<LoopDeps, 'workspaceSlug' | 'prepare'> = {
  pool: sys.app,
  tokens,
  bus,
  runtimes: { 'claude-cli': createCliRuntime('claude-cli'), opencode: createCliRuntime('opencode'), codex: createCliRuntime('codex'), 'openai-agents': createOpenAIAgentsRuntime({ osUrl: sys.osUrl }), http: createHttpRuntime({ osUrl: sys.osUrl, url: workerUrl, instructionsFor: readStanding, allowRemote: process.env.HTTP_ALLOW_REMOTE === '1' }) },
  dataDir: sys.dataDir,
  templatesRoot: sys.templatesRoot,
  // A run that says nothing for this long is stopped (A2). RUN_SILENCE_MINUTES changes it; 0 turns it off.
  silenceMs: Number(process.env.RUN_SILENCE_MINUTES ?? 5) * 60_000,
  // A transient model error is retried after 5 seconds, 20 seconds and a minute, then once on the agent's fallback model (S3-2).
  retry: { delaysMs: [5_000, 20_000, 60_000] },
};
const execute = async (e: RunRequestEvent) => executeRun(await runtimes.loop(loopBase, e.workspaceId), e.workspaceId, e.agentId, e.trigger);

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
// Companies that have been got ready (S6-13e): a company made while the server runs is got ready the first time it is seen.
const started = new Set<string>([sys.workspace.id]);
const runEveryMinute = async () => {
  const tz = process.env.COMPANY_TIMEZONE?.trim() || undefined; // schedules are read in the company's time zone; unset means this machine's
  const woken: string[] = [];
  for (const rt of await runtimes.all()) {
    try {
      if (!started.has(rt.company.id)) {
        started.add(rt.company.id);
        const r = await runtimes.start(rt);
        console.log(`company ${rt.company.name}: ${r.agents} agent folder(s) ready`);
      }
      woken.push(
        ...(await runCompanyMinute(rt, {
          dispatcher,
          asked,
          bus,
          isRunActive,
          tz,
          briefTime: process.env.BRIEF_TIME?.trim() || '06:30', // HH:MM in the company's time zone
          // The notifier speaks for the owner's one phone; a brief of another company is not pushed to it.
          onBrief: (day, company) => {
            if (company.isDefault) void notifier.notify('brief', day).catch((err) => console.error('push:', err));
          },
          recordReaped: (r) => reaperStatus.record(r),
          log: (line) => console.log(line),
        })),
      );
    } catch (err) {
      console.error(`scheduled work for ${rt.company.name}:`, err);
    }
  }
  // The daily backup: a database dump beside the data (it holds every company), the last 14 kept, and a commit of the company folder (S3-9).
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

// The default company's parts are the ones built above; every other company's are made when first needed.
runtimes.adopt({ company: { id: sys.workspace.id, slug: sys.workspace.slug, name: await companyName(sys.companyRoot), root: sys.companyRoot, isDefault: true }, executors, gate, transport, pool: sys.app });
const gateOf = async (workspaceId: string) => (await runtimes.runtime(workspaceId))?.gate;
const onGateError = (err: unknown) => console.error('approval gate:', err);
proposalQueued = (w, id) => {
  void gateOf(w).then((g) => g?.requested(id)).catch(onGateError);
  bus.publish({ kind: 'approval.changed', workspaceId: w, approvalId: id, status: 'pending' });
  void notifier.notify('approval_waiting', id).catch((err) => console.error('push:', err));
};

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
// Push notifications for the installed app: the brief, a failed executor and an approval waiting, and nothing else (S5-10).
const vapid = ensureVapidKeys(sys.dataDir);
const notifier = createNotifier({ pool: sys.app, workspaceId: sys.workspace.id, sender: webPushSender(vapid, process.env.PUSH_SUBJECT?.trim() || 'mailto:conclave-os@example.invalid') });
notifier.attach(bus);
attachOfficeEvents(bus); // the office looks again when a run, an approval or a discussion changes (S6-3)
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
    push: { notifier, publicKey: vapid.publicKey },
    reaperStatus,
    companyRoot: sys.companyRoot,
    templatesRoot: sys.templatesRoot,
    companies,
    bus,
    dispatcher,
    upgradeWebSocket,
    hosts: [`127.0.0.1:${sys.serverPort}`, `localhost:${sys.serverPort}`, new URL(authConfig.apiOrigin).host, `${authConfig.host}:${sys.serverPort}`],
    ...(auth ? { auth } : {}),
    onApprovalDecided: async (d) => {
      await (await gateOf(d.workspaceId))?.decided(d);
    },
    onCompanyReload: async () => {
      const synced = await syncCompany(sys.app, sys.workspace.id, await loadCompany(sys.companyRoot));
      return { departments: synced.departments, agents: synced.agents, funnels: synced.funnels, goals: synced.goals };
    },
    onReleaseHeld: async () => {
      let sent = 0;
      for (const rt of await runtimes.all()) sent += (await rt.gate.release()).released;
      return sent;
    },
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

// The other companies are got ready too: their folders copied in, their agent folders made, their stopped runs failed, their decided approvals carried out.
for (const rt of await runtimes.all()) {
  if (rt.company.isDefault) continue;
  started.add(rt.company.id);
  try {
    const r = await runtimes.start(rt);
    console.log(`company ${rt.company.name}: ${r.agents} agent folder(s) ready`);
  } catch (err) {
    console.error(`company ${rt.company.name} could not be started:`, err);
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
  runtimes.stop();
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
