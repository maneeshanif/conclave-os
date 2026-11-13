import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { baselineOf, compare, loadSet, referenceDrafter, runEval, type EvalLead } from '../src/eval';

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
/** A drafter that follows the skill: short, names the company and the observation. */
const good = referenceDrafter;
/** The same skill after a bad change: the drafts run long. */
const wordy = async (l: EvalLead) => `Subject: A idea for ${l.company}\n\nHi ${l.contact}, I noticed ${l.observation}. ${words(200)}`;
const set = loadSet('outreach');

describe('the sample eval set (S3-8)', () => {
  it('has 20 leads, each clearly a sample, each with what its draft must mention', () => {
    expect(set.leads).toHaveLength(20);
    expect(set.note).toMatch(/sample/i);
    expect(new Set(set.leads.map((l) => l.id)).size).toBe(20);
    for (const l of set.leads) {
      expect(l.company && l.contact && l.observation).toBeTruthy();
      expect(l.mustMention.length).toBeGreaterThan(0);
      expect(JSON.stringify(l)).not.toMatch(/@/); // sample leads have no email addresses at all
    }
  });
});

describe('scoring (S3-8)', () => {
  it('scores a good skill at 20 of 20, every draft passing the output check and the lead checks', async () => {
    const r = await runEval(set, good);
    expect(r.total).toBe(20);
    expect(r.passed).toBe(20);
    expect(r.score).toBe(1);
  });

  it('fails a draft that leaves out what the lead check requires, and says what', async () => {
    const r = await runEval(set, async (l) => `Subject: Hello\n\nHi, I would love to chat about growth for ${l.contact}.`);
    expect(r.passed).toBe(0);
    expect(r.results[0]!.reasons.join(' ')).toMatch(/does not mention/i);
  });

  it('counts a drafter that throws as a failure for that lead, not a crash', async () => {
    const r = await runEval(set, async (l) => {
      if (l.id === set.leads[3]!.id) throw new Error('model unavailable');
      return good(l);
    });
    expect(r.passed).toBe(19);
    expect(r.results[3]!.reasons.join(' ')).toMatch(/model unavailable/);
  });

  it('is stable: the same skill scores the same twice', async () => {
    expect(await runEval(set, good)).toEqual(await runEval(set, good));
  });
});

describe('the gate (S3-8)', () => {
  it('passes the unchanged skill against its own baseline', async () => {
    const base = baselineOf(set, await runEval(set, good));
    const g = compare(base, await runEval(set, good));
    expect(g.ok).toBe(true);
    expect(g.regressions).toEqual([]);
  });

  it('fails a change that makes drafts over-long, naming the leads that got worse', async () => {
    const base = baselineOf(set, await runEval(set, good));
    const g = compare(base, await runEval(set, wordy));
    expect(g.ok).toBe(false);
    expect(g.score).toBe(0);
    expect(g.baselineScore).toBe(1);
    expect(g.regressions).toHaveLength(20);
    expect(g.regressions[0]!.reasons.join(' ')).toMatch(/170/);
    expect(g.summary).toMatch(/20 of 20 leads got worse/);
  });

  it('fails when one lead that used to pass now fails, even if another improved', async () => {
    const weakBase = baselineOf(set, await runEval(set, async (l) => (l.id === set.leads[0]!.id ? 'nothing' : good(l))));
    const g = compare(weakBase, await runEval(set, async (l) => (l.id === set.leads[1]!.id ? 'nothing' : good(l))));
    expect(g.ok).toBe(false);
    expect(g.regressions.map((r) => r.id)).toEqual([set.leads[1]!.id]);
  });

  it('lets an improvement through and says so', async () => {
    const weakBase = baselineOf(set, await runEval(set, async (l) => (l.id === set.leads[0]!.id ? 'nothing' : good(l))));
    const g = compare(weakBase, await runEval(set, good));
    expect(g.ok).toBe(true);
    expect(g.summary).toMatch(/better/i);
  });

  it('refuses to compare against a baseline for a different set or one that is missing', async () => {
    const base = baselineOf(set, await runEval(set, good));
    const now = await runEval(set, good);
    expect(() => compare({ ...base, set: 'other' }, now)).toThrow(/different set/i);
  });

  it('loads and saves a baseline file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conclave-eval-'));
    try {
      const base = baselineOf(set, await runEval(set, good));
      const f = join(dir, 'baseline.json');
      writeFileSync(f, JSON.stringify(base));
      expect(JSON.parse(readFileSync(f, 'utf8')).passed).toHaveLength(20);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the stored baseline for the shipped set matches what a good skill scores', async () => {
    const stored = JSON.parse(readFileSync(new URL('../../../eval/outreach/baseline.json', import.meta.url), 'utf8'));
    expect(compare(stored, await runEval(set, good)).ok).toBe(true);
    expect(stored.total).toBe(20);
  });
});
