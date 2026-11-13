import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const read = (f: string) => readFileSync(path.join(root, f), 'utf8');
const clone = path.join(process.env.DATA_DIR ?? path.join(homedir(), '.conclave-os'), 'reference', 'jsm-hq');

describe('the jsm-hq study (S6-14a)', () => {
  it('has reference notes that name the licence, the library and the gaps', () => {
    const notes = read('docs/JSM-REFERENCE.md');
    expect(notes).toMatch(/MIT/);
    expect(notes).toMatch(/PixiJS/);
    expect(notes).toMatch(/Gaps against our/);
    expect(notes).toMatch(/No code, art or text from it is in this repo/);
  });

  it('records the licence and the library decision', () => {
    const decisions = read('docs/DECISIONS.md');
    expect(decisions).toMatch(/S6-14a: jsm-hq, licence and library/);
    expect(decisions).toMatch(/Copyright \(c\) 2026 JavaScript Mastery/);
    expect(decisions).toMatch(/Phaser stays our only world library/);
  });

  it('lists it in the credits as studied with nothing copied', () => {
    const credits = read('docs/CREDITS.md');
    expect(credits).toMatch(/jsmastery-pro\/jsm-hq/);
    expect(credits).toMatch(/MIT/);
    expect(credits).toMatch(/nothing copied/i);
  });

  it('keeps the clone and the screenshots out of the repo', () => {
    expect(path.relative(root, clone).startsWith('..')).toBe(true);
    expect(read('.gitignore')).toMatch(/^\.reference\/$/m);
    const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n');
    expect(tracked.filter((f) => f.startsWith('.reference/') || f.includes('jsm-hq/'))).toEqual([]);
  });

  it('has no file in the repo that is a copy of one in the clone', () => {
    const src = path.join(clone, 'src');
    if (!existsSync(src)) return; // the clone is not on this machine, so there is nothing to compare with
    const sums = new Map<string, string>();
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (statSync(p).size > 200) sums.set(createHash('sha256').update(readFileSync(p)).digest('hex'), path.relative(clone, p));
      }
    };
    walk(src);
    const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
    const copies = tracked.filter((f) => {
      const p = path.join(root, f);
      return existsSync(p) && statSync(p).isFile() && statSync(p).size > 200 && sums.has(createHash('sha256').update(readFileSync(p)).digest('hex'));
    });
    expect(copies).toEqual([]);
  });
});
