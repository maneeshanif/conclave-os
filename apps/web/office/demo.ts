/**
 * Demo mode (jsm-hq's demo with speed controls): the people in the office act out a day on their own, so you can see what a busy office looks
 * like. It is only for looking: it changes how people are drawn on this screen, writes nothing, asks nothing of the server, and never
 * touches a task or an approval. Pure and seeded, so a test can run a whole day.
 */
export const SPEEDS = [1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

const CYCLE = ['idle', 'working', 'working', 'working', 'discussion', 'working', 'handoff', 'working', 'waiting', 'working', 'blocked', 'idle'] as const;

/** A small deterministic number generator, so the same office acts out the same day. */
function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export class DemoSim {
  private readonly at = new Map<string, number>();
  private readonly left = new Map<string, number>();
  private readonly rand: () => number;
  private ticks = 0;

  constructor(ids: string[], seed = 7) {
    this.rand = lcg(seed);
    for (const id of ids) {
      this.at.set(id, Math.floor(this.rand() * CYCLE.length));
      this.left.set(id, 1 + Math.floor(this.rand() * 3));
    }
  }

  /** Moves the day on by one step; each person stays in a state for a few steps, then moves to the next in their day. */
  tick(): void {
    this.ticks++;
    for (const id of this.at.keys()) {
      const n = (this.left.get(id) ?? 1) - 1;
      if (n > 0) {
        this.left.set(id, n);
        continue;
      }
      this.at.set(id, ((this.at.get(id) ?? 0) + 1) % CYCLE.length);
      this.left.set(id, 1 + Math.floor(this.rand() * 3));
    }
  }

  states(): Map<string, string> {
    return new Map([...this.at].map(([id, i]) => [id, CYCLE[i]!] as [string, string]));
  }

  get steps(): number {
    return this.ticks;
  }
}

/** How long between steps at a speed: 1x is a step every 3 seconds, 2x every 1.5, 4x every 0.75. */
export function stepMs(speed: Speed): number {
  return 3000 / speed;
}

/** The next speed in 1x, 2x, 4x and back to 1x. */
export function nextSpeed(s: Speed): Speed {
  return SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length]!;
}
