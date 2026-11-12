import { Inngest } from 'inngest';
import type { RunOutcome } from '../harness/loop';
import { approvalGateHandler, type GateOps, type GateStep } from './approval-gate';
import type { Dispatcher, RunRequestEvent } from './dispatch';

/** The `agent-run` limits (SPEC 14): two runs at once and one per agent, or in lite mode (S3-10) one run at a time. */
export function agentRunConcurrency(lite: boolean): [{ limit: number }] | [{ limit: number }, { limit: number; key: string }] {
  return lite ? [{ limit: 1 }] : [{ limit: 2 }, { limit: 1, key: 'event.data.agentId' }];
}

/**
 * Inngest functions (SPEC 11, 14). `agent-run` is the only thing that starts a run, with the two
 * concurrency limits from SPEC 14; `ticker` sends heartbeats once a minute.
 */
export function createWorkflows(deps: {
  execute(e: RunRequestEvent): Promise<RunOutcome>;
  tickAll(): Promise<string[]>;
  /** What the approval gate does. Without it the gate function is not registered (S1-3). */
  approvals?: GateOps;
  /** Lite mode: one run at a time (S3-10). */
  lite?: boolean;
}) {
  const inngest = new Inngest({ id: 'conclave-os' });

  const agentRun = inngest.createFunction(
    {
      id: 'agent-run',
      retries: 0, // a failed run marks its task blocked; a person decides what happens next
      concurrency: agentRunConcurrency(deps.lite ?? false),
      triggers: [{ event: 'agent/run.requested' }],
    },
    async ({ event, step }) => {
      const data = event.data as RunRequestEvent;
      return step.run('execute', () => deps.execute(data));
    },
  );

  const ticker = inngest.createFunction(
    { id: 'ticker', retries: 0, triggers: [{ cron: '* * * * *' }] },
    async ({ step }) => step.run('tick', () => deps.tickAll()),
  );

  // The approval gate (SPEC 6): waits for a decision up to three days, then runs the executor once. No retries.
  const approvalGate = deps.approvals
    ? inngest.createFunction(
        { id: 'approval-gate', retries: 0, triggers: [{ event: 'approval/requested' }] },
        async ({ event, step }) => approvalGateHandler(deps.approvals!)({ event: event as unknown as { data: { approvalId: string } }, step: step as unknown as GateStep }),
      )
    : undefined;

  const dispatcher: Dispatcher = {
    name: 'inngest',
    async request(e) {
      await inngest.send({ name: 'agent/run.requested', data: e });
    },
  };

  return { inngest, functions: approvalGate ? [agentRun, approvalGate, ticker] : [agentRun, ticker], dispatcher };
}
