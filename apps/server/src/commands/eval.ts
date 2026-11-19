import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { baselineOf, compare, loadSet, referenceDrafter, runEval, type Baseline, type Drafter } from '../eval';

const BASELINE = (name: string) => new URL(`../../../../eval/${name}/baseline.json`, import.meta.url);

/**
 * `pnpm run eval:gate` and `pnpm run eval:baseline` (S3-8). The drafts come from `--drafts <file>` (a JSON object of lead id
 * to draft text, written by whatever produced them) or from `--reference`, the deterministic drafter. A model-backed drafter
 * is not here yet: it spends plan usage, so it waits for the founder's say-so (docs/NEEDS-YOU.md).
 */
export async function evalCommand(mode: 'gate' | 'baseline', argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv.filter((a) => a !== '--'), options: { set: { type: 'string', default: 'outreach' }, drafts: { type: 'string' }, reference: { type: 'boolean', default: false }, by: { type: 'string' } } });
  const name = values.set as string;
  let drafter: Drafter;
  let by = values.by ?? 'drafts file';
  if (values.reference) {
    drafter = referenceDrafter;
    by = 'reference drafter';
  } else if (values.drafts) {
    const drafts = JSON.parse(readFileSync(values.drafts, 'utf8')) as Record<string, string>;
    drafter = async (l) => {
      const d = drafts[l.id];
      if (typeof d !== 'string') throw new Error(`no draft for ${l.id} in ${values.drafts}`);
      return d;
    };
  } else {
    console.error('Give --drafts <file.json> (lead id to draft text) or --reference.');
    return 2;
  }
  const set = loadSet(name);
  const result = await runEval(set, drafter);
  console.log(`${name}: ${result.passed} of ${result.total} drafts pass (${Math.round(result.score * 100)}%)`);
  if (mode === 'baseline') {
    writeFileSync(BASELINE(name), JSON.stringify(baselineOf(set, result, by), null, 2) + '\n');
    console.log(`baseline written for ${name}, set by ${by}`);
    return 0;
  }
  if (!existsSync(BASELINE(name))) {
    console.error(`There is no baseline for ${name}. Run eval:baseline first.`);
    return 2;
  }
  const gate = compare(JSON.parse(readFileSync(BASELINE(name), 'utf8')) as Baseline, result);
  console.log(gate.summary);
  for (const r of gate.regressions) console.log(`  worse: ${r.id}: ${r.reasons.join(' ')}`);
  return gate.ok ? 0 : 1;
}
