import type pg from 'pg';
import { agentNew, renderAll, renderOne } from './commands/agent-new';
import { companyMarkdown } from './actions/policy';
import type { Executors } from './actions';
import type { EmailTransport } from './actions/transport';
import { ensureDailyBrief } from './brief/build';
import type { Bus } from './bus';
import { loadCompany } from './company/loader';
import { syncCompany } from './company/sync';
import type { Companies, Company } from './companies';
import { closeBudgetItems } from './harness/budget';
import { reapStaleRuns, type LoopDeps } from './harness/loop';
import { liftExpiredPauses } from './harness/pauses';
import { reapRuns, type ReapResult } from './harness/reaper';
import { createOutreach } from './outreach';
import type { System } from './system';
import { assembleGenerated } from './video/assemble';
import { LocalApprovalGate, type ApprovalGate } from './workflows/approval-gate';
import { tick, type Dispatcher } from './workflows/dispatch';
import { runSequences } from './workflows/sequences';

/**
 * The parts that act for one company (SPEC 6, 14): the executors that carry out its approvals, the gate that waits for its decisions,
 * the run loop's view of its folder, and its scheduled work. Each company has its own, built for its workspace and its folder, so
 * nothing one of them does can reach another: an approval is carried out by the executors of the company it belongs to, a run
 * renders the agent folder from that company's role files, and a minute of scheduled work reads only that company's rows.
 */
export interface Runtime {
  company: Company;
  executors: Executors;
  gate: ApprovalGate;
  transport: EmailTransport;
  pool: pg.Pool;
}

type Env = Record<string, string | undefined>;
export interface RuntimesOptions {
  sys: System;
  companies: Companies;
  bus: Bus;
  env: Env;
  /** A gate other than the in-process one for a company (the default company may use Inngest). */
  gateFor?: (company: Company, executors: Executors) => ApprovalGate | undefined;
}

export class CompanyRuntimes {
  private readonly made = new Map<string, Promise<Runtime>>();
  /** Each known company's folder, kept so code that cannot wait (reading COMPANY.md during a tool call) can find it. */
  private readonly roots = new Map<string, string>();

  constructor(private readonly o: RuntimesOptions) {
    this.roots.set(o.sys.workspace.id, o.sys.companyRoot);
  }

  /** The folder of a company that has been seen, or nothing. */
  rootFor(ws: string): string | undefined {
    return this.roots.get(ws);
  }

  /** The system as one company sees it: its folder and its workspace. */
  sysFor(c: Company): System {
    return { ...this.o.sys, companyRoot: c.root, workspace: { id: c.id, slug: c.slug } };
  }

  /** Registers parts that were built elsewhere (the default company's, made when the server starts). */
  adopt(rt: Runtime): void {
    this.made.set(rt.company.id, Promise.resolve(rt));
    this.roots.set(rt.company.id, rt.company.root);
  }

  /** The parts for a company on the list, made the first time they are asked for. Null for one that is not on the list. */
  async runtime(ws: string): Promise<Runtime | null> {
    const have = this.made.get(ws);
    if (have) return have;
    const company = await this.o.companies.get(ws);
    if (!company) return null;
    this.roots.set(company.id, company.root);
    const built = this.build(company);
    this.made.set(ws, built);
    return built;
  }

  async all(): Promise<Runtime[]> {
    const out: Runtime[] = [];
    for (const c of await this.o.companies.list()) {
      const rt = await this.runtime(c.id);
      if (rt) out.push(rt);
    }
    return out;
  }

  private async build(company: Company): Promise<Runtime> {
    const { sys, bus, env } = this.o;
    const { transport, executors } = createOutreach({
      pool: sys.app,
      workspaceId: company.id,
      dataDir: sys.dataDir,
      companyRoot: company.root,
      bus,
      env,
      agentFactory: (opts) => agentNew(this.sysFor(company), opts),
    });
    const gate = this.o.gateFor?.(company, executors) ?? new LocalApprovalGate({ pool: sys.app, workspaceId: company.id, bus, executors });
    return { company, executors, gate, transport, pool: sys.app };
  }

  /** What the run loop uses for one company: the shared parts, with that company's slug and its own folder for each agent. */
  async loop(base: Omit<LoopDeps, 'workspaceSlug' | 'prepare'>, ws: string): Promise<LoopDeps> {
    const rt = await this.runtime(ws);
    if (!rt) throw new Error(`Unknown company ${ws}.`);
    const sys = this.sysFor(rt.company);
    return { ...base, workspaceSlug: rt.company.slug, prepare: (agentKey, over) => renderOne(sys, agentKey, over) };
  }

  /**
   * Gets one company ready: its folder is copied into its rows (a mistake in a file stops this, with the file and the reason), every
   * agent's working folder is made from its role file, runs a stopped server left running are failed, and the approvals decided while
   * it was down are carried out. The default company does the same from the server's own start-up.
   */
  async start(rt: Runtime): Promise<{ agents: number; reaped: number }> {
    const sys = this.sysFor(rt.company);
    await syncCompany(this.o.sys.app, rt.company.id, await loadCompany(rt.company.root));
    const rendered = await renderAll(sys);
    const reaped = await reapStaleRuns(this.o.sys.app, rt.company.id);
    await rt.gate.recover();
    return { agents: rendered.length, reaped };
  }

  stop(): void {
    for (const p of this.made.values()) void p.then((rt) => rt.gate instanceof LocalApprovalGate && rt.gate.stop());
  }
}

export interface MinuteDeps {
  dispatcher: Dispatcher;
  /** When each agent was last asked, so an idle one is not asked again every minute. Kept for each company by the caller. */
  asked: Map<string, Date>;
  bus: Bus;
  isRunActive: (runId: string) => boolean;
  /** The time zone schedules are read in (unset: this machine's). */
  tz?: string | undefined;
  /** HH:MM, in that time zone, after which the morning brief is made. */
  briefTime?: string | undefined;
  /** Told when a brief was made (for a notification). */
  onBrief?: (day: string, company: Company) => void;
  /** Where the last reaper pass is recorded for the Health screen. */
  recordReaped?: (r: ReapResult) => void;
  log?: (line: string) => void;
}

/**
 * One minute of scheduled work for one company (S0-13, S2-5, S3-1, S3-3, S3-4, S5-9): wake agents whose heartbeat is due, make the
 * morning brief, lay out generated video, fail silent runs and put their tasks back, let go of a plan limit that has reset and of an
 * agent back under budget, and make sequence step tasks. Every step reads and writes only this company's rows. Returns the agents woken.
 */
export async function runCompanyMinute(rt: Runtime, d: MinuteDeps): Promise<string[]> {
  const ws = rt.company.id;
  const log = d.log ?? (() => undefined);
  const sys = rt.pool;
  const woken = await tick(sys, ws, d.dispatcher, new Date(), d.asked, d.tz ? { tz: d.tz } : {});
  const brief = await ensureDailyBrief({ pool: sys, workspaceId: ws, tz: d.tz, after: d.briefTime ?? '06:30' });
  if (brief) {
    log(`morning brief for ${brief.day} is ready (${rt.company.name})`);
    d.onBrief?.(brief.day, rt.company);
  }
  const assembled = await assembleGenerated(sys, ws, await companyMarkdown(rt.company.root));
  if (assembled.ready.length || assembled.failed.length) log(`video: ${assembled.ready.length} plan(s) ready, ${assembled.failed.length} failed review`);
  const reaped = await reapRuns({ pool: sys, workspaceId: ws, isActive: d.isRunActive });
  d.recordReaped?.(reaped);
  for (const t of reaped.requeued) void d.dispatcher.request({ workspaceId: ws, agentId: t.agentId, trigger: 'task_assigned' });
  if (reaped.reaped.length) log(`reaper (${rt.company.name}): failed ${reaped.reaped.length} silent run(s); ${reaped.requeued.length} task(s) put back, ${reaped.blocked.length} blocked`);
  const lifted = await liftExpiredPauses({ pool: sys, workspaceId: ws });
  for (const agentId of lifted.agentsWithWork) void d.dispatcher.request({ workspaceId: ws, agentId, trigger: 'task_assigned' });
  if (lifted.lifted.length) log(`plan limit reset: ${lifted.lifted.join(', ')} can run again`);
  const budgets = await closeBudgetItems({ pool: sys, workspaceId: ws });
  for (const agentId of budgets.agentsWithWork) void d.dispatcher.request({ workspaceId: ws, agentId, trigger: 'task_assigned' });
  const seq = await runSequences({ pool: sys, workspaceId: ws, bus: d.bus });
  if (seq.created) log(`sequences: made ${seq.created} step task(s)`);
  return woken;
}
