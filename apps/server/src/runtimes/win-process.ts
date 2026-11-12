// Starting and stopping a CLI on Windows (SPEC 5, the runner; SPEC 14).
//
// Two Windows facts drive this file:
//  1. An npm-installed CLI is a `.cmd` shim. Starting a `.cmd` needs a shell, and a shell means quoting rules
//     and an extra process. The shim only forwards to a real program, so we read it and start that program.
//  2. `child.kill()` ends the process we started, not the processes it started. A CLI runs tools as children,
//     so a cancelled run would leave them behind. `taskkill /T /F` ends the whole tree.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface ResolvedCommand {
  file: string;
  args: string[];
  shell: boolean;
}

export interface CommandSpec {
  command: string;
  prefixArgs?: string[];
}

const DP0 = String.raw`(?:%dp0%|%~dp0)\\?`;
// "%_prog%" "%dp0%\node_modules\pkg\bin\cli.js" %*      (or node.exe beside the shim, or plain node)
const SCRIPT_SHIM = new RegExp(String.raw`"(?:%_prog%|${DP0}node\.exe|node)"\s+"${DP0}([^"]+)"\s+%\*`, 'i');
// "%dp0%\node_modules\pkg\bin\tool.exe" %*
const EXE_SHIM = new RegExp(String.raw`"${DP0}([^"]+?\.exe)"\s+%\*`, 'i');

/** Reads an npm `.cmd` shim and says what it starts. Undefined when the shim is not one we understand. */
export function parseCmdShim(contents: string, shimDir: string, nodeExe: string): { file: string; args: string[] } | undefined {
  const inDir = (relative: string) => path.join(shimDir, ...relative.split(/[\\/]+/).filter(Boolean));
  const script = SCRIPT_SHIM.exec(contents);
  if (script?.[1]) return { file: nodeExe, args: [inDir(script[1])] };
  const exe = EXE_SHIM.exec(contents);
  if (exe?.[1]) return { file: inDir(exe[1]), args: [] };
  return undefined;
}

export interface ResolveOptions {
  env: Record<string, string | undefined>;
  /** PATH separator. `;` on Windows. A parameter so the resolver can be tested anywhere. */
  sep?: string;
  /** The node to start a script shim with. */
  nodeExe?: string;
  exists?: (file: string) => boolean;
  read?: (file: string) => string;
}

/**
 * Finds `name.exe`, or a `.cmd` shim, on PATH. Prefers starting the real program with no shell. A shell is the
 * last resort, for a `.cmd` we cannot read or a command we cannot find.
 */
export function resolveWindowsCommand(cmd: CommandSpec, opts: ResolveOptions): ResolvedCommand {
  const prefix = cmd.prefixArgs ?? [];
  if (path.isAbsolute(cmd.command) || path.win32.isAbsolute(cmd.command)) return { file: cmd.command, args: prefix, shell: false };

  const exists = opts.exists ?? existsSync;
  const read = opts.read ?? ((f: string) => readFileSync(f, 'utf8'));
  const nodeExe = opts.nodeExe ?? process.execPath;
  const exts = (opts.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase());
  const dirs = (opts.env.PATH ?? opts.env.Path ?? '').split(opts.sep ?? ';').filter(Boolean);

  for (const dir of dirs) {
    for (const ext of ['.exe', ...exts.filter((e) => e !== '.exe')]) {
      const full = path.join(dir, cmd.command + ext);
      if (!exists(full)) continue;
      if (ext === '.exe' || ext === '.com') return { file: full, args: prefix, shell: false };
      let shim: { file: string; args: string[] } | undefined;
      try {
        shim = parseCmdShim(read(full), dir, nodeExe);
      } catch {
        shim = undefined;
      }
      if (shim && exists(shim.args[0] ?? shim.file)) return { file: shim.file, args: [...shim.args, ...prefix], shell: false };
      return { file: full, args: prefix, shell: true };
    }
  }
  return { file: cmd.command, args: prefix, shell: true };
}

/** Quotes one argument for cmd.exe. Arguments here are fixed flags and file paths, never user text. */
export function quoteForCmd(a: string): string {
  return /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a;
}

/** One command line with every part quoted, for the shell fallback. */
export function commandLine(resolved: ResolvedCommand, extra: string[] = []): string {
  return [resolved.file, ...resolved.args, ...extra].map(quoteForCmd).join(' ');
}

/** Elsewhere the command is started as given. On Windows, shims are read first (see resolveWindowsCommand). */
export function resolveCommand(cmd: CommandSpec, env: Record<string, string | undefined>, platform: NodeJS.Platform = process.platform): ResolvedCommand {
  if (platform !== 'win32') return { file: cmd.command, args: cmd.prefixArgs ?? [], shell: false };
  return resolveWindowsCommand(cmd, { env });
}

/**
 * Starts a resolved command. Almost always that is the program itself with an argument list and no shell.
 * Only the last-resort fallback uses a shell, and then as one quoted command string: Node warns (DEP0190)
 * about handing a shell an argument list, because it only joins the arguments without escaping them.
 */
export function spawnResolved(resolved: ResolvedCommand, extra: string[], options: SpawnOptions): ChildProcess {
  if (resolved.shell) return spawn(commandLine(resolved, extra), { ...options, shell: true });
  return spawn(resolved.file, [...resolved.args, ...extra], { ...options, shell: false });
}

/** The command that ends a process and everything it started, or undefined where `child.kill()` is enough. */
export function killCommand(platform: NodeJS.Platform, pid: number): { file: string; args: string[] } | undefined {
  return platform === 'win32' ? { file: 'taskkill', args: ['/pid', String(pid), '/T', '/F'] } : undefined;
}

/** Ends the child and, on Windows, its own children. */
export function killTree(child: ChildProcess, platform: NodeJS.Platform = process.platform): void {
  const cmd = child.pid ? killCommand(platform, child.pid) : undefined;
  if (!cmd) {
    child.kill();
    return;
  }
  spawn(cmd.file, cmd.args, { stdio: 'ignore', windowsHide: true }).on('error', () => child.kill());
}
