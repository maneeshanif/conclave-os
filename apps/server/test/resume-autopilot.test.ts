import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../src/paths';

/**
 * The claim and usage-limit logic of scripts/resume-autopilot.ps1 (the external auto-resume). The script's functions are
 * loaded by dot-sourcing it, which runs nothing; the dry run then checks the whole decision end to end without starting Claude.
 */
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'resume-autopilot.ps1');
const windows = process.platform === 'win32';

function ps(command: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `. '${SCRIPT}'; ${command}`], { encoding: 'utf8', timeout: 60_000 }).trim();
}
const json = <T>(command: string): T => JSON.parse(ps(`(${command}) | ConvertTo-Json -Compress`)) as T;
const NOW = "([datetime]'2026-11-13 12:00:00')";

let dir = '';
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'conclave-resume-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const progress = (line: string) => {
  const f = path.join(dir, `p-${Math.random().toString(36).slice(2)}.md`);
  writeFileSync(f, `# Progress\n\n- **Last done:** something\n${line}\n- **Next:** more\n`);
  return f.replace(/\\/g, '/');
};

describe.skipIf(!windows)('the claim in PROGRESS.md (auto-resume)', () => {
  it('reads how old the "Working now" claim is, from the time written on its line', () => {
    expect(json<number>(`Get-ClaimAgeMinutes '${progress('- **Working now:** S5-2, laptop, 2026-11-13 11:30')}' ${NOW}`)).toBe(30);
    expect(json<number>(`Get-ClaimAgeMinutes '${progress('- **Working now:** S5-2 (a note, 2026-01-01 09:00), laptop, 2026-11-13 11:59')}' ${NOW}`)).toBe(1); // the last time on the line
  });

  it('finds no claim when there is none, or none with a time, or no file', () => {
    expect(ps(`$null -eq (Get-ClaimAgeMinutes '${progress('- **Working now:** nothing')}' ${NOW})`)).toBe('True');
    expect(ps(`$null -eq (Get-ClaimAgeMinutes '${progress('- **Working now:** S5-2, laptop')}' ${NOW})`)).toBe('True');
    expect(ps(`$null -eq (Get-ClaimAgeMinutes '${path.join(dir, 'missing.md').replace(/\\/g, '/')}' ${NOW})`)).toBe('True');
  });

  it('calls a claim live under 45 minutes, a future one live, and an old or missing one not live', () => {
    expect(ps('Test-ClaimLive 44 45')).toBe('True');
    expect(ps('Test-ClaimLive 45 45')).toBe('False');
    expect(ps('Test-ClaimLive 600 45')).toBe('False');
    expect(ps('Test-ClaimLive -20 45')).toBe('True');
    expect(ps('Test-ClaimLive $null 45')).toBe('False');
  });
});

describe.skipIf(!windows)('the usage limit (auto-resume)', () => {
  it('recognises a limit message', () => {
    expect(ps("Test-UsageLimitText 'Claude AI usage limit reached|1763053200'")).toBe('True');
    expect(ps("Test-UsageLimitText 'You have hit your limit, resets 5pm'")).toBe('True');
    expect(ps("Test-UsageLimitText 'All 12 tasks done'")).toBe('False');
  });

  it('reads the reset from a Unix time, from "resets 5pm" (today or tomorrow), and falls back to five hours', () => {
    const at = Math.floor(new Date('2026-11-13T17:00:00').getTime() / 1000);
    expect(ps(`(Get-LimitResetTime 'usage limit reached|${at}' ${NOW}).ToString('yyyy-MM-dd HH:mm')`)).toBe('2026-11-13 17:00');
    expect(ps(`(Get-LimitResetTime 'limit hit, resets 5pm' ${NOW}).ToString('yyyy-MM-dd HH:mm')`)).toBe('2026-11-13 17:00');
    expect(ps(`(Get-LimitResetTime 'limit hit, resets at 9:30 am' ${NOW}).ToString('yyyy-MM-dd HH:mm')`)).toBe('2026-11-14 09:30');
    expect(ps(`(Get-LimitResetTime 'limit hit' ${NOW}).ToString('yyyy-MM-dd HH:mm')`)).toBe('2026-11-13 17:00'); // five hours on
    const past = Math.floor(new Date('2026-11-13T08:00:00').getTime() / 1000);
    expect(ps(`(Get-LimitResetTime 'limit|${past}' ${NOW}).ToString('yyyy-MM-dd HH:mm')`)).toBe('2026-11-13 17:00'); // in the past: ignored
  });

  it('skips until the saved reset time and not after it', () => {
    const f = path.join(dir, 'limit.txt');
    writeFileSync(f, new Date('2026-11-13T12:30:00').toISOString());
    const p = f.replace(/\\/g, '/');
    expect(ps(`$null -ne (Get-ActiveLimit '${p}' ${NOW})`)).toBe('True');
    expect(ps(`$null -ne (Get-ActiveLimit '${p}' ([datetime]'2026-11-13 12:31:00'))`)).toBe('False');
    writeFileSync(f, 'garbage');
    expect(ps(`$null -ne (Get-ActiveLimit '${p}' ${NOW})`)).toBe('False');
    expect(ps(`$null -ne (Get-ActiveLimit '${path.join(dir, 'none.txt').replace(/\\/g, '/')}' ${NOW})`)).toBe('False');
  });
});

describe.skipIf(!windows)('a run started by the script (auto-resume)', () => {
  it('is seen while it lives and not after it ends, and a pid reused by something else is not mistaken for it', () => {
    const pidFile = path.join(dir, 'resume.pid').replace(/\\/g, '/');
    const out = ps(
      [
        "$p = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile','-Command','Start-Sleep 30' -PassThru -WindowStyle Hidden",
        `Set-Content -Path '${pidFile}' -Value ('{0} {1}' -f $p.Id, $p.StartTime.ToUniversalTime().ToString('o'))`,
        '$alive = Test-OwnRunAlive ' + `'${pidFile}'`,
        `Set-Content -Path '${pidFile}' -Value ('{0} {1}' -f $p.Id, '2001-01-01T00:00:00.0000000Z')`,
        '$reused = Test-OwnRunAlive ' + `'${pidFile}'`,
        `Set-Content -Path '${pidFile}' -Value ('{0} {1}' -f $p.Id, $p.StartTime.ToUniversalTime().ToString('o'))`,
        'Stop-Process -Id $p.Id -Force; Start-Sleep -Milliseconds 500',
        '$dead = Test-OwnRunAlive ' + `'${pidFile}'`,
        '"$alive $reused $dead"',
      ].join('; '),
    );
    expect(out).toBe('True False False');
    expect(ps(`Test-OwnRunAlive '${path.join(dir, 'nofile.pid').replace(/\\/g, '/')}'`)).toBe('False');
  }, 60_000);
});

describe.skipIf(!windows)('the whole decision, as a dry run (auto-resume)', () => {
  const repo = (claim: string, branch = 'dev') => {
    const root = mkdtempSync(path.join(dir, 'repo-'));
    mkdirSync(path.join(root, 'docs'));
    writeFileSync(path.join(root, 'docs', 'PROGRESS.md'), `# Progress\n${claim}\n`);
    execFileSync('git', ['init', '-q', '-b', branch], { cwd: root });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: root });
    return root;
  };
  const run = (root: string, data: string, extra: string[] = []) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-RepoRoot', root, '-DataDir', data, '-DryRun', ...extra], { encoding: 'utf8', timeout: 60_000 });
  const stamp = (minutesAgo: number) => {
    const d = new Date(Date.now() - minutesAgo * 60_000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const log = (data: string) => readFileSync(path.join(data, 'logs', 'resume.log'), 'utf8');

  it('skips and logs when a task was claimed ten minutes ago', () => {
    const data = mkdtempSync(path.join(dir, 'data-'));
    run(repo(`- **Working now:** S5-2, laptop, ${stamp(10)}`), data);
    expect(log(data)).toMatch(/skip: someone claimed a task \d+ minutes ago/);
  });

  it('starts (as a dry run) when the claim is two hours old, in auto mode, and never skipping permission checks', () => {
    const data = mkdtempSync(path.join(dir, 'data-'));
    const out = run(repo(`- **Working now:** S5-2, laptop, ${stamp(120)}`), data);
    expect(out).toMatch(/--permission-mode auto/);
    expect(out).toMatch(/--permission-prompts none/);
    expect(out).not.toMatch(/dangerously|bypassPermissions/i);
    expect(log(data)).toMatch(/dry run: would start/);
    expect(existsSync(path.join(data, 'logs', 'resume.pid'))).toBe(false); // nothing was started
  });

  it('starts when there is no claim at all', () => {
    const data = mkdtempSync(path.join(dir, 'data-'));
    run(repo('- **Working now:** nothing'), data);
    expect(log(data)).toMatch(/dry run: would start/);
  });

  it('skips on any branch but dev, and while a saved usage limit has not passed', () => {
    const d1 = mkdtempSync(path.join(dir, 'data-'));
    run(repo('- **Working now:** nothing', 'master'), d1);
    expect(log(d1)).toMatch(/skip: the repo is on 'master', not dev/);
    const d2 = mkdtempSync(path.join(dir, 'data-'));
    mkdirSync(path.join(d2, 'logs'));
    writeFileSync(path.join(d2, 'logs', 'resume-limit.txt'), new Date(Date.now() + 3_600_000).toISOString());
    run(repo('- **Working now:** nothing'), d2);
    expect(log(d2)).toMatch(/skip: usage limit until/);
  });

  it('logs every check, one line each, in the order they happened', () => {
    const data = mkdtempSync(path.join(dir, 'data-'));
    const root = repo('- **Working now:** nothing');
    run(root, data);
    run(root, data);
    expect(log(data).trim().split('\n')).toHaveLength(2);
  });
});
