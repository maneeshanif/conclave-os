import type pg from 'pg';
import { withWorkspace } from '../db/tenant';
import { selectMeetingConnector, type MeetingConnector } from '../meetings/connector';
import { selectGitConnector, type GitConnector, type PrInput, type PushInput } from '../projects/git-connector';

/**
 * Connectors you can switch from Settings, with no restart. The choice is kept in the database (`workspace_settings.connectors`) and read
 * each time a connector is used; where nothing was chosen the environment's value (the old way) is the default. A name that is not known is
 * refused when it is set, so a typo cannot quietly pick the wrong one. Keys and sign-ins are never kept here: this is only which one.
 */
export const CHOICES = {
  git: ['local', 'gh'],
  meeting: ['local', 'livekit'],
} as const;
export type ConnectorKind = keyof typeof CHOICES;

export function isChoice(kind: string, name: string): boolean {
  return Object.hasOwn(CHOICES, kind) && (CHOICES[kind as ConnectorKind] as readonly string[]).includes(name);
}

/** What is chosen now for one kind: the saved choice, else the environment's, else `local`. */
export async function chosen(pool: pg.Pool, workspaceId: string, kind: ConnectorKind, fromEnv: string | undefined): Promise<string> {
  const row = (await withWorkspace(pool, workspaceId, ({ client }) => client.query<{ c: Record<string, string> | null }>('select connectors as c from workspace_settings'))).rows[0];
  const saved = row?.c?.[kind];
  return saved && isChoice(kind, saved) ? saved : fromEnv?.trim() || 'local';
}

/** The code host, picked again at every call. */
export class SwitchableGit implements GitConnector {
  readonly name = 'switchable';
  constructor(
    private readonly pool: pg.Pool,
    private readonly workspaceId: string,
    private readonly fromEnv: string | undefined,
    private readonly localRoot: string,
  ) {}
  private async now(): Promise<GitConnector> {
    return selectGitConnector(await chosen(this.pool, this.workspaceId, 'git', this.fromEnv), this.localRoot);
  }
  async push(i: PushInput) {
    return (await this.now()).push(i);
  }
  async remoteHead(projectKey: string, branch: string) {
    return (await this.now()).remoteHead(projectKey, branch);
  }
  async openPullRequest(i: PrInput) {
    return (await this.now()).openPullRequest(i);
  }
  async createRepo(i: { projectKey: string; workPath: string; description: string }) {
    return (await this.now()).createRepo(i);
  }
  async merge(i: { projectKey: string; projectPath: string; base: string; branch: string; number: number; title: string }) {
    return (await this.now()).merge(i);
  }
}

/**
 * Meetings, picked again at every call. The local stand-in keeps the rooms it opened in memory, so one is kept for the life of the server
 * and used whenever `local` is chosen (a room opened then can be closed later).
 */
export class SwitchableMeeting implements MeetingConnector {
  readonly name = 'switchable';
  private readonly local = selectMeetingConnector('local');
  constructor(
    private readonly pool: pg.Pool,
    private readonly workspaceId: string,
    private readonly fromEnv: string | undefined,
  ) {}
  private async now(): Promise<MeetingConnector> {
    const name = await chosen(this.pool, this.workspaceId, 'meeting', this.fromEnv);
    return name === 'local' ? this.local : selectMeetingConnector(name);
  }
  async createRoom(i: { meetingId: string; title: string }) {
    return (await this.now()).createRoom(i);
  }
  async closeRoom(room: string) {
    return (await this.now()).closeRoom(room);
  }
}
