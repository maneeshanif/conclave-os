'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type DepartmentBoardData, type DepartmentChannelData } from '../lib/api';
import { socketEvents, type LiveMessage } from '../lib/live';
import { Button } from './ui/button';

export interface DepartmentClient {
  board(dept: string): Promise<DepartmentBoardData>;
  channel(dept: string): Promise<DepartmentChannelData>;
  say(dept: string, body: string): Promise<unknown>;
}
const real: DepartmentClient = { board: api.departmentBoard, channel: api.departmentChannel, say: api.departmentSay };
type Events = (onMessage: (m: LiveMessage) => void) => () => void;

const GROUPS: { status: string; title: string }[] = [
  { status: 'in_progress', title: 'In progress' },
  { status: 'waiting_approval', title: 'Waiting for you' },
  { status: 'blocked', title: 'Blocked' },
  { status: 'todo', title: 'To do' },
];

/** A department's shared board (S6-13d): the open tasks of its agents, by state, and who has each. It follows live changes. */
export function DepartmentBoard({ dept, client = real, onEvents = socketEvents }: { dept: string; client?: DepartmentClient; onEvents?: Events }) {
  const [data, setData] = useState<DepartmentBoardData | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await client.board(dept));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [client, dept]);
  useEffect(() => {
    void load();
    const off = onEvents((m) => {
      if (m.kind === 'task.changed' || m.kind === 'run.state' || m.kind === 'approval.changed') void load();
    });
    const t = setInterval(() => void load(), 15_000);
    return () => {
      off();
      clearInterval(t);
    };
  }, [load, onEvents]);

  if (failed && !data) return <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">Cannot load this department. It may have been removed, or the server is not running.</p>;
  if (!data) return <p className="text-sm text-neutral-500">Loading…</p>;
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{data.department.name}</h2>
      <ul aria-label="Agents" className="flex flex-wrap gap-2">
        {data.agents.map((a) => (
          <li key={a.key} className="rounded-full border border-neutral-300 px-3 py-1 text-sm">
            {a.name}
          </li>
        ))}
      </ul>
      {data.tasks.length === 0 ? <p className="text-sm text-neutral-500">Nothing is open in this department.</p> : null}
      {GROUPS.map((g) => {
        const rows = data.tasks.filter((t) => t.status === g.status);
        if (!rows.length) return null;
        return (
          <section key={g.status} role="region" aria-label={g.title} className="space-y-2">
            <h3 className="text-sm font-semibold text-neutral-700">{g.title}</h3>
            <ul className="space-y-1">
              {rows.map((t) => (
                <li key={t.id} className="rounded-md border border-neutral-200 px-3 py-2 text-sm">
                  <span className="block font-medium">{t.title}</span>
                  <span className="text-xs text-neutral-500">{t.assignee_name ?? 'unassigned'}</span>
                  {t.blocked_reason ? <span className="mt-1 block text-xs text-amber-800">{t.blocked_reason}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

const who = (author: string) => (author === 'founder' ? 'You' : author.replace(/^agent:/, ''));

/** A department's channel (S6-13d): short messages between its agents and you, oldest first, with a box to write in. */
export function DepartmentChannel({ dept, client = real, onEvents = socketEvents }: { dept: string; client?: DepartmentClient; onEvents?: Events }) {
  const [data, setData] = useState<DepartmentChannelData | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const load = useCallback(async () => {
    try {
      setData(await client.channel(dept));
    } catch {
      setError('Cannot load the channel. Is the server running?');
    }
  }, [client, dept]);
  useEffect(() => {
    void load();
    const off = onEvents((m) => {
      if (m.kind === 'department.changed' && m.department === dept) void load();
    });
    // An agent's own post does not announce itself, so look again now and then.
    const t = setInterval(() => void load(), 15_000);
    return () => {
      off();
      clearInterval(t);
    };
  }, [load, onEvents, dept]);

  async function send() {
    const body = text.trim();
    if (!body || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await client.say(dept, body);
      setText('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {data && data.messages.length === 0 ? <p className="text-sm text-neutral-500">No messages yet. Say something to the department.</p> : null}
      {data && data.messages.length > 0 ? (
        <ul aria-label="Messages" className="space-y-2">
          {data.messages.map((m) => (
            <li key={m.id} className="rounded-md bg-neutral-50 px-3 py-2 text-sm">
              <div className="mb-1 text-xs text-neutral-500">
                {who(m.author)} · {new Date(m.created_at).toLocaleString()}
              </div>
              <div className="whitespace-pre-wrap">{m.body}</div>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="space-y-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} aria-label="Message" placeholder="Write to the department" className="w-full rounded-md border border-neutral-300 p-2 text-sm" />
        <Button type="button" disabled={!text.trim() || busy} onClick={() => void send()}>
          Send
        </Button>
      </div>
    </div>
  );
}
