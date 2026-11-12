import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { modelNameFor, resolveModel } from '../config/models';
import type { RuntimeName } from './names';
import { claudeParser, opencodeParser, type Parser } from './parsers';
import { RUN_TOKEN_ENV, type RunEvent, type RunRequest, type Runtime, type RuntimeHealth } from './types';

/** How to start a CLI. Tests point this at a fake script; production uses the binary on PATH. */
export interface CliCommand {
  command: string;
  prefixArgs?: string[];
}

export interface CliRuntimeOptions {
  command?: CliCommand;
  /** The environment the child is built from. Defaults to process.env. Only allow-listed names are copied. */
  baseEnv?: NodeJS.ProcessEnv;
}

/**
 * Environment names a CLI needs to find its own sign-in and run at all. Nothing else from the
 * server's environment reaches an agent (CLAUDE.md rule 4). Windows needs its profile folders.
 */
export const ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'LANG',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'SYSTEMROOT',
  'SystemRoot',
  'TEMP',
  'TMP',
  'PATHEXT',
  'COMSPEC',
  'ComSpec',
];

export function cleanEnv(base: NodeJS.ProcessEnv, extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ENV_ALLOWLIST) {
    const v = base[k];
    if (v !== undefined) env[k] = v;
  }
  return { ...env, ...extra };
}

/** On Windows, finds `name.exe` or `name.cmd` on PATH. A `.cmd` needs a shell to start. */
function resolveCommand(cmd: CliCommand, env: Record<string, string>): { file: string; args: string[]; shell: boolean } {
  const prefix = cmd.prefixArgs ?? [];
  if (process.platform !== 'win32' || path.isAbsolute(cmd.command)) {
    return { file: cmd.command, args: prefix, shell: false };
  }
  const exts = (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase());
  for (const dir of (env.PATH ?? '').split(';')) {
    for (const ext of ['.exe', ...exts.filter((e) => e !== '.exe')]) {
      const full = path.join(dir, cmd.command + ext);
      if (existsSync(full)) return { file: full, args: prefix, shell: ext !== '.exe' && ext !== '.com' };
    }
  }
  return { file: cmd.command, args: prefix, shell: true };
}

/** Quotes one argument for cmd.exe. Arguments here are fixed flags and file paths, never user text. */
function quoteForCmd(a: string): string {
  return /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a;
}

interface Built {
  args: string[];
  extraEnv: Record<string, string>;
  parser: Parser;
  /** What goes on stdin. Prompts never go on the command line. */
  stdin?: string;
}

async function writeRunFiles(req: RunRequest): Promise<{ system: string; prompt: string }> {
  const dir = path.join(req.workspaceDir, '.conclave', 'runs', req.runId);
  await mkdir(dir, { recursive: true });
  const system = path.join(dir, 'context.md');
  const prompt = path.join(dir, 'task.md');
  await writeFile(system, req.instructions, 'utf8');
  await writeFile(prompt, req.taskInput, 'utf8');
  return { system, prompt };
}

const builders: Record<'claude-cli' | 'opencode', (req: RunRequest, files: { system: string; prompt: string }) => Built> = {
  'claude-cli': (req, files) => {
    const model = modelNameFor(req.modelAlias, 'claude-cli');
    return {
      args: [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        ...(model ? ['--model', model] : []),
        '--append-system-prompt-file',
        files.system,
        '--mcp-config',
        path.join(req.workspaceDir, '.mcp.json'),
        '--strict-mcp-config',
        '--settings',
        path.join(req.workspaceDir, '.claude', 'settings.json'),
        '--setting-sources',
        'project',
        '--permission-mode',
        'dontAsk',
        ...(req.allowedTools?.length ? ['--allowedTools', req.allowedTools.join(',')] : []),
        ...(req.deniedTools?.length ? ['--disallowedTools', req.deniedTools.join(',')] : []),
        ...(req.sessionId ? ['--resume', req.sessionId] : []),
      ],
      extraEnv: {},
      parser: claudeParser(),
      stdin: req.taskInput,
    };
  },
  opencode: (req, files) => {
    const model = modelNameFor(req.modelAlias, 'opencode');
    return {
      args: [
        'run',
        // The message comes first: `--file` takes several values and would swallow it.
        'Do the task in the attached task.md, using the context in context.md.',
        '--format',
        'json',
        '--agent',
        req.agentKey,
        ...(model ? ['--model', model] : []),
        ...(req.sessionId ? ['--session', req.sessionId] : []),
        '--file',
        files.system,
        '--file',
        files.prompt,
      ],
      extraEnv: {
        // Keep the person's own skills out of company agents (checked with opencode 1.19.5).
        OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
        OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
        OPENCODE_DISABLE_AUTOUPDATE: '1',
      },
      parser: opencodeParser(),
    };
  },
};

const DEFAULT_BIN: Record<'claude-cli' | 'opencode', string> = { 'claude-cli': 'claude', opencode: 'opencode' };

/** Replaces the run token wherever it might appear in text that gets stored or shown. */
function redact(e: RunEvent, token: string): RunEvent {
  if (!token) return e;
  const s = JSON.stringify(e);
  return s.includes(token) ? (JSON.parse(s.split(token).join('***')) as RunEvent) : e;
}

/** One runner for every signed-in CLI (SPEC 5, the runner). */
export function createCliRuntime(name: 'claude-cli' | 'opencode', opts: CliRuntimeOptions = {}): Runtime {
  const children = new Map<string, ChildProcess>();
  const cancelled = new Set<string>();
  const command = opts.command ?? { command: DEFAULT_BIN[name] };

  async function* start(req: RunRequest): AsyncIterable<RunEvent> {
    const files = await writeRunFiles(req);
    const built = builders[name](req, files);
    const model = resolveModel(req.modelAlias);
    const env = cleanEnv(opts.baseEnv ?? process.env, {
      ...(model.env ?? {}),
      ...built.extraEnv,
      [RUN_TOKEN_ENV]: req.runToken,
    });
    const resolved = resolveCommand(command, env);
    const args = [...resolved.args, ...built.args];
    const child = spawn(resolved.file, resolved.shell ? args.map(quoteForCmd) : args, {
      cwd: req.workspaceDir,
      env,
      shell: resolved.shell,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    children.set(req.runId, child);

    const queue: RunEvent[] = [];
    let wake: (() => void) | undefined;
    let closed = false;
    let exitCode: number | null = null;
    let stderr = '';
    let killedFor: RunEvent | undefined;
    const push = (e: RunEvent) => {
      queue.push(redact(e, req.runToken));
      wake?.();
    };
    const kill = (reason: RunEvent) => {
      if (killedFor) return;
      killedFor = reason;
      child.kill();
    };

    child.stdin?.on('error', () => undefined);
    child.stdin?.end(built.stdin ?? '');
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < 20_000) stderr += d.toString();
    });
    const timer = setTimeout(
      () => kill({ type: 'error', kind: 'timeout', message: `no result after ${req.timeoutMs ?? 900_000} ms` }),
      req.timeoutMs ?? 900_000,
    );
    const lines = child.stdout ? createInterface({ input: child.stdout }) : undefined;
    lines?.on('line', (line) => {
      if (killedFor) return;
      for (const e of built.parser.line(line)) push(e);
      if (built.parser.turns() > req.maxTurns) {
        kill({ type: 'error', kind: 'max_turns', message: `stopped after ${req.maxTurns} turns` });
      }
    });
    child.on('error', (err) => {
      stderr += `\n${err.message}`;
    });
    child.on('close', (code) => {
      exitCode = code;
      closed = true;
      wake?.();
    });

    let ended = false;
    try {
      while (true) {
        while (queue.length) {
          const e = queue.shift()!;
          if (e.type === 'done' || e.type === 'error') {
            if (ended) continue;
            ended = true;
          }
          yield e;
        }
        if (closed) break;
        await new Promise<void>((r) => (wake = r));
        wake = undefined;
      }
      // Drain lines that arrived just before close.
      while (queue.length) {
        const e = queue.shift()!;
        if ((e.type === 'done' || e.type === 'error') && ended) continue;
        if (e.type === 'done' || e.type === 'error') ended = true;
        yield e;
      }
      if (!ended) {
        if (cancelled.has(req.runId)) {
          yield { type: 'error', kind: 'cancelled', message: 'cancelled' };
        } else if (killedFor) {
          yield killedFor;
        } else {
          for (const e of built.parser.end(exitCode, stderr)) {
            const r = redact(e, req.runToken);
            if (r.type === 'done' || r.type === 'error') {
              if (ended) continue;
              ended = true;
            }
            yield r;
          }
        }
      }
    } finally {
      clearTimeout(timer);
      children.delete(req.runId);
      cancelled.delete(req.runId);
      if (!closed) child.kill();
    }
  }

  return {
    name: name as RuntimeName,
    canResume: true,
    start,
    async cancel(runId) {
      const child = children.get(runId);
      if (!child) return;
      cancelled.add(runId);
      child.kill();
    },
    async health(): Promise<RuntimeHealth> {
      const env = cleanEnv(opts.baseEnv ?? process.env, {});
      const resolved = resolveCommand(command, env);
      return new Promise((resolve) => {
        const child = spawn(resolved.file, [...resolved.args, '--version'], { env, shell: resolved.shell, windowsHide: true });
        let out = '';
        child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
        child.on('error', (err) => resolve({ ok: false, detail: `${command.command} not found: ${err.message}` }));
        child.on('close', (code) =>
          resolve(code === 0 ? { ok: true, detail: out.trim() } : { ok: false, detail: `${command.command} --version exited ${code}` }),
        );
      });
    },
  };
}
