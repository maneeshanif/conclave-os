import type { Dispatcher } from '../workflows/dispatch';
import { cancelAllRuns } from './loop';

/**
 * What turning the kill switch on does to work already in motion (the loop and the executors separately refuse
 * to start anything while it is on). Queued run requests are dropped first, so cancelling the run in progress
 * cannot let the next one in the queue start. On Inngest there is no local queue to drop: a request that
 * arrives is refused by the loop's own check.
 */
export async function stopEverything(dispatcher: Dispatcher): Promise<{ dropped: number; cancelled: number }> {
  const queue = dispatcher as Dispatcher & { clearQueue?: () => number };
  const dropped = typeof queue.clearQueue === 'function' ? queue.clearQueue() : 0;
  const cancelled = await cancelAllRuns();
  return { dropped, cancelled };
}
