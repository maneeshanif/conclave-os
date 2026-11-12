import { EventEmitter } from 'node:events';
import type { RunEvent } from './runtimes/types';

/** Live updates for the web app (SPEC 12, live updates). In-process only; the database is the record. */
export type BusMessage =
  | { kind: 'run.event'; workspaceId: string; runId: string; taskId: string | null; seq: number; event: RunEvent }
  | { kind: 'run.state'; workspaceId: string; runId: string; taskId: string | null; status: string; error?: string }
  | { kind: 'task.changed'; workspaceId: string; taskId: string }
  | { kind: 'approval.changed'; workspaceId: string; approvalId: string; status: string }
  | { kind: 'settings.changed'; workspaceId: string };

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
