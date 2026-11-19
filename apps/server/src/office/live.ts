import type { Bus } from '../bus';

/**
 * The office listens to the same events the panels use (SPEC 12) and tells the world to look again when something that moves an
 * agent happens: a run starting or ending, an approval queued or decided, a discussion opening or closing. It carries no data;
 * the world asks `/api/office/state`, so it can never show something the tables do not say.
 */
export function attachOfficeEvents(bus: Bus): () => void {
  return bus.subscribe((m) => {
    if (m.kind === 'run.state' || m.kind === 'approval.changed' || m.kind === 'discussion.changed') bus.publish({ kind: 'office.changed', workspaceId: m.workspaceId });
  });
}
