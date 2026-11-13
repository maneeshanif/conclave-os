import type pg from 'pg';
import { createExecutors, type Executors } from './actions';
import { browserPostTransport, outboxDmTransport, outboxPostTransport } from './actions/post-transport';
import { playwrightDriver } from './browser/driver';
import { playwrightPageOpener } from './browser/playwright';
import { transportFromEnv, type EmailTransport } from './actions/transport';
import type { Bus } from './bus';
import type { ApprovalDecision } from './routes/approvals';
import type { ApprovalGate } from './workflows/approval-gate';

export interface OutreachDeps {
  pool: pg.Pool;
  workspaceId: string;
  dataDir: string;
  /** Where COMPANY.md lives: the footer and the prices an email may quote come from it. */
  companyRoot: string;
  bus?: Bus;
  env: Record<string, string | undefined>;
}

/**
 * The email side of the server (SPEC 6, 10): the transport and the executors that use it.
 *
 * The transport is the outbox, a folder of files, unless OUTREACH_TRANSPORT=resend and RESEND_API_KEY are both
 * set. Nothing leaves the machine by default, and an API key alone changes nothing. The sender address comes
 * from OUTREACH_FROM and is never invented: with none, the executor refuses and says so.
 */
export function createOutreach(d: OutreachDeps): { transport: EmailTransport; executors: Executors } {
  const transport = transportFromEnv(d.env, d.dataDir);
  const executors = createExecutors({
    pool: d.pool,
    workspaceId: d.workspaceId,
    transport,
    companyRoot: d.companyRoot,
    from: (d.env.OUTREACH_FROM ?? '').trim(),
    // Posts go to a folder, like email. The browser transport needs a login done by hand and is switched on per account (S5-3).
    postTransport: outboxPostTransport(d.dataDir),
    dmTransport: outboxDmTransport(d.dataDir),
    // Generated assets are stored here. There is no generation connector until the founder chooses a generator (S5-8).
    dataDir: d.dataDir,
    // Used only for an account a person has logged in to by hand and switched to the browser (S5-3).
    browserPostTransport: browserPostTransport(d.dataDir, playwrightDriver(playwrightPageOpener(d.dataDir, d.env))),
    bus: d.bus,
  });
  return { transport, executors };
}

/** The three things the rest of the server calls into the approval gate for. */
export function approvalHooks(gate: ApprovalGate, onError: (err: unknown) => void = (err) => console.error('approval gate:', err)) {
  return {
    /** A proposal was just queued: start waiting for a decision. Not awaited by the caller. */
    onApprovalRequested: (_workspaceId: string, approvalId: string): void => {
      void gate.requested(approvalId).catch(onError);
    },
    /** A decision has committed. */
    onApprovalDecided: (d: ApprovalDecision): Promise<void> => gate.decided(d),
    /** The founder asked for the held approvals to go. Returns how many were sent. */
    onReleaseHeld: async (): Promise<number> => (await gate.release()).released,
  };
}
