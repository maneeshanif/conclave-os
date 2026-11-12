import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** What a run token resolves to. The `os` server trusts nothing else about the caller (SPEC 6). */
export interface RunScope {
  workspaceId: string;
  agentId: string;
  runId: string;
  taskId?: string;
}

interface Entry {
  scope: RunScope;
  expiresAt: number;
  hash: Buffer;
}

const sha = (s: string) => createHash('sha256').update(s).digest();

/**
 * Short-lived tokens, one per run, kept only in server memory and only as hashes.
 * A restart invalidates them, which is fine: a restart also ends every run.
 */
export class RunTokens {
  private byHash = new Map<string, Entry>();
  private byRun = new Map<string, string>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(scope: RunScope, ttlMs = 60 * 60 * 1000): string {
    this.revokeRun(scope.runId);
    const token = `crt_${randomBytes(32).toString('base64url')}`;
    const hash = sha(token);
    const key = hash.toString('hex');
    this.byHash.set(key, { scope, expiresAt: this.now() + ttlMs, hash });
    this.byRun.set(scope.runId, key);
    return token;
  }

  resolve(token: string | undefined | null): RunScope | null {
    if (!token) return null;
    const hash = sha(token);
    const entry = this.byHash.get(hash.toString('hex'));
    if (!entry || !timingSafeEqual(entry.hash, hash)) return null;
    if (entry.expiresAt <= this.now()) {
      this.revokeRun(entry.scope.runId);
      return null;
    }
    return entry.scope;
  }

  revokeRun(runId: string): void {
    const key = this.byRun.get(runId);
    if (key) this.byHash.delete(key);
    this.byRun.delete(runId);
  }
}
