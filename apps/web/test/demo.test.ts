import { describe, expect, it } from 'vitest';
import { DemoSim, nextSpeed, stepMs, SPEEDS } from '../office/demo';

describe('demo mode', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];

  it('gives everyone a state the office already knows how to draw', () => {
    const known = new Set(['working', 'waiting', 'blocked', 'discussion', 'handoff', 'idle']);
    const sim = new DemoSim(ids);
    for (let i = 0; i < 200; i++) {
      sim.tick();
      for (const [id, s] of sim.states()) {
        expect(ids).toContain(id);
        expect(known.has(s)).toBe(true);
      }
    }
    expect(sim.states().size).toBe(ids.length);
  });

  it('acts out the same day every time for the same seed, and a different one for another', () => {
    const run = (seed: number) => {
      const s = new DemoSim(ids, seed);
      const out: string[] = [];
      for (let i = 0; i < 40; i++) {
        s.tick();
        out.push([...s.states().values()].join(','));
      }
      return out.join('|');
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(8));
  });

  it('changes over time, and in a long day everyone is seen working and everyone is seen idle', () => {
    const sim = new DemoSim(ids);
    const seen = new Map(ids.map((id) => [id, new Set<string>()]));
    for (let i = 0; i < 300; i++) {
      sim.tick();
      for (const [id, s] of sim.states()) seen.get(id)!.add(s);
    }
    for (const id of ids) {
      expect(seen.get(id)!.has('working')).toBe(true);
      expect(seen.get(id)!.has('idle')).toBe(true);
      expect(seen.get(id)!.size).toBeGreaterThan(3);
    }
    expect(sim.steps).toBe(300);
  });

  it('does nothing with nobody in the office', () => {
    const sim = new DemoSim([]);
    sim.tick();
    expect(sim.states().size).toBe(0);
  });

  it('has speeds of 1x, 2x and 4x that cycle, and faster means a shorter wait', () => {
    expect([...SPEEDS]).toEqual([1, 2, 4]);
    expect(nextSpeed(1)).toBe(2);
    expect(nextSpeed(2)).toBe(4);
    expect(nextSpeed(4)).toBe(1);
    expect(stepMs(1)).toBe(3000);
    expect(stepMs(2)).toBe(1500);
    expect(stepMs(4)).toBe(750);
  });
});
