/**
 * Wraps a task so it never overlaps itself (lite mode, S3-10): a call that arrives while one is running is skipped and
 * answers `whenSkipped`. The next call after the running one ends, even by throwing, runs normally.
 */
export function singleFlight<T>(fn: () => Promise<T>, whenSkipped: T): () => Promise<T> {
  let running = false;
  return async () => {
    if (running) return whenSkipped;
    running = true;
    try {
      return await fn();
    } finally {
      running = false;
    }
  };
}
