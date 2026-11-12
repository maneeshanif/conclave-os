import { Inngest } from 'inngest';
import type { RunOutcome } from '../harness/loop';
import type { Dispatcher, RunRequestEvent } from './dispatch';

/**
 * Inngest functions (SPEC 11, 14). `agent-run` is the only thing that starts a run, with the two
 * concurrency limits from SPEC 14; `ticker` sends heartbeats once a minute.
 */
export function createWorkflows(deps: {
  execute(e: RunRequestEvent): Promise<RunOutcome>;
  tickAll(): Promise<string[]>;
}) {
  const inngest = new Inngest({ id: 'conclave-os' });

  const agentRun = inngest.createFunction(
    {
      id: 'agent-run',
      retries: 0, // a failed run marks its task blocked; a person decides what happens next
      concurrency: [{ limit: 2 }, { limit: 1, key: 'event.data.agentId' }],
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

  const dispatcher: Dispatcher = {
    name: 'inngest',
    async request(e) {
      await inngest.send({ name: 'agent/run.requested', data: e });
    },
  };

  return { inngest, functions: [agentRun, ticker], dispatcher };
}
