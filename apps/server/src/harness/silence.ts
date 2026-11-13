/**
 * The silent-run watchdog (borrow audit A2). A run can be alive and say nothing: a hung model call, a stuck tool. The 15 minute
 * run timeout is far too long to wait on that. This watches the gaps between events: if the source goes quiet for `ms`, it calls
 * `onSilent` (to cancel the runtime), yields one last event of the caller's making, and ends, without waiting for the hung
 * source to finish. Silence is counted from the last event, so a long run that keeps talking is never touched. `ms <= 0` turns it off.
 */
export async function* withSilenceWatchdog<T>(source: AsyncIterable<T>, ms: number, onSilent: () => void | Promise<void>, silentEvent: (ms: number) => T): AsyncGenerator<T> {
  if (ms <= 0) {
    yield* source;
    return;
  }
  const it = source[Symbol.asyncIterator]();
  for (;;) {
    let timer: NodeJS.Timeout | undefined;
    const silence = new Promise<'silent'>((resolve) => {
      timer = setTimeout(() => resolve('silent'), ms);
    });
    const next = it.next();
    next.catch(() => undefined); // if we walk away from it, a later failure of the abandoned call is nobody's news
    const first = await Promise.race([next, silence]);
    clearTimeout(timer);
    if (first === 'silent') {
      try {
        await onSilent();
      } finally {
        void Promise.resolve(it.return?.()).catch(() => undefined);
      }
      yield silentEvent(ms);
      return;
    }
    if (first.done) return;
    yield first.value;
  }
}
