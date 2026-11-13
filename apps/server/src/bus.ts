import { EventEmitter } from 'node:events';
import type { RunEvent } from './runtimes/types';

/** Live updates for the web app (SPEC 12, live updates). In-process only; the database is the record. */
export type BusMessage =
  | { kind: 'run.event'; workspaceId: string; runId: string; taskId: string | null; seq: number; event: RunEvent }
  | { kind: 'run.state'; workspaceId: string; runId: string; taskId: string | null; status: string; error?: string }
  | { kind: 'task.changed'; workspaceId: string; taskId: string }
  | { kind: 'approval.changed'; workspaceId: string; approvalId: string; status: string }
  | { kind: 'settings.changed'; workspaceId: string }
  | { kind: 'action_item.changed'; workspaceId: string; itemId: string }
  /** A Boardroom discussion opened, got a turn or closed (S6-10). */
  | { kind: 'discussion.changed'; workspaceId: string; discussionId: string }
  /** Something that moves an agent in the office happened; the world asks /api/office/state again (S6-3). */
  | { kind: 'office.changed'; workspaceId: string };

export class Bus {
  private ee = new EventEmitter();
  constructor() {
    this.ee.setMaxListeners(100);
  }
  publish(m: BusMessage) {
    this.ee.emit('m', m);
  }
  subscribe(fn: (m: BusMessage) => void): () => void {
    this.ee.on('m', fn);
    return () => this.ee.off('m', fn);
  }
}
