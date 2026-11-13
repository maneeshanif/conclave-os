'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { RunLog } from '../components/RunLog';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input, Select, Textarea } from '../components/ui/field';
import { API, api, type Agent, type Run, type StoredEvent, type Task, type TaskDetail } from '../lib/api';

/** Slice 0: one plain page. Tasks, a form, and a live log of each run (S0-9). */
export default function Home() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const runRef = useRef<string | null>(null);
  runRef.current = runId;
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  const refresh = useCallback(async () => {
    try {
      const [a, t] = await Promise.all([api.agents(), api.tasks()]);
      setAgents(a);
      setTasks(t);
      setError(null);
    } catch (err) {
      setError(`Cannot reach the server at ${API}. Is \`pnpm dev\` running? (${(err as Error).message})`);
    }
  }, []);

  const loadTask = useCallback(async (id: string) => {
    const d = await api.task(id);
    setDetail(d);
    const last = d.runs.at(-1);
    if (last) {
      setRunId(last.id);
      const r = await api.run(last.id);
      setRun(r.run);
      setEvents(r.events);
    } else {
      setRunId(null);
      setRun(null);
      setEvents([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (selected) void loadTask(selected);
  }, [selected, loadTask]);

  // Live updates over one WebSocket (SPEC 12).
  useEffect(() => {
    let socket: WebSocket | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      socket = new WebSocket(`${API.replace(/^http/, 'ws')}/events`);
      socket.onopen = () => setLive(true);
      socket.onclose = () => {
        setLive(false);
        if (!stopped) retry = setTimeout(connect, 2000);
      };
      socket.onmessage = (msg) => {
        const m = JSON.parse(String(msg.data));
        if (m.kind === 'run.event') {
          if (m.taskId === selectedRef.current) {
            if (runRef.current !== m.runId) {
              setRunId(m.runId);
              setEvents([]);
            }
            setEvents((prev) => [...prev, { id: `live-${m.seq}`, type: m.event.type, data: m.event }]);
          }
        } else if (m.kind === 'run.state' || m.kind === 'task.changed') {
          void refresh();
          if (m.taskId === selectedRef.current) void loadTask(m.taskId);
        }
      };
    };
    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [refresh, loadTask]);
  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget; // React clears currentTarget after the first await
    const f = new FormData(form);
    const title = String(f.get('title') ?? '').trim();
    if (!title) return;
    try {
      const assigneeId = String(f.get('assignee') ?? '');
      const { id } = await api.createTask({ title, body: String(f.get('body') ?? '') || undefined, ...(assigneeId ? { assigneeId } : {}) });
      form.reset();
      await refresh();
      setSelected(id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Events may arrive live with string ids; keep their arrival order.
  const ordered = events.map((e, i) => ({ ...e, id: typeof e.id === 'number' ? e.id : 1e12 + i }));

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Conclave OS</h1>
          <p className="text-sm text-neutral-500">Slice 0: tasks and runs. The office comes in slice 6.</p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/approvals" className="text-sm font-medium underline">
            Approvals
          </Link>
          <Link href="/action-items" className="text-sm font-medium underline">
            Needs you
          </Link>
          <Link href="/brief" className="text-sm font-medium underline">
            Brief
          </Link>
          <Link href="/inbox" className="text-sm font-medium underline">
            Inbox
          </Link>
          <Link href="/pipeline" className="text-sm font-medium underline">
            Pipeline
          </Link>
          <Link href="/campaigns" className="text-sm font-medium underline">
            Campaigns
          </Link>
          <Link href="/goals" className="text-sm font-medium underline">
            Goals
          </Link>
          <Link href="/signals" className="text-sm font-medium underline">
            Signals
          </Link>
          <Link href="/health" className="text-sm font-medium underline">
            Health
          </Link>
          <span className={`text-xs ${live ? 'text-green-700' : 'text-neutral-400'}`}>{live ? '● live' : '○ offline'}</span>
        </div>
      </header>
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <section className="space-y-6">
          <form onSubmit={onCreate} className="space-y-2 rounded-md border border-neutral-200 p-3">
            <h2 className="text-sm font-semibold">New task</h2>
            <Input name="title" placeholder="What should be done?" aria-label="Title" required />
            <Textarea name="body" placeholder="Details and context (optional)" aria-label="Details" />
            <Select name="assignee" aria-label="Assign to" defaultValue="">
              <option value="">Unassigned</option>
              {agents
                .filter((a) => a.status === 'active')
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.department} · {a.runtime}
                  </option>
                ))}
            </Select>
            <Button type="submit" className="w-full">
              Create and run
            </Button>
          </form>

          <div>
            <h2 className="mb-2 text-sm font-semibold">Agents</h2>
            {agents.length === 0 && <p className="text-sm text-neutral-500">No agents yet. Run `pnpm agent:new researcher --department research`.</p>}
            <ul className="space-y-1">
              {agents.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">
                    {a.name} <span className="text-neutral-500">· {a.runtime}</span>
                  </span>
                  <Button variant="outline" className="h-7 px-2 text-xs" onClick={() => void api.runAgent(a.id)} disabled={a.status !== 'active'}>
                    Run now
                  </Button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold">Tasks</h2>
            <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
              {tasks.length === 0 && <li className="px-3 py-2 text-sm text-neutral-500">No tasks yet.</li>}
              {tasks.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setSelected(t.id)}
                    className={`flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50 ${selected === t.id ? 'bg-neutral-50' : ''}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{t.title}</span>
                      <span className="text-xs text-neutral-500">{t.assignee_name ?? 'unassigned'}</span>
                    </span>
                    <Badge value={t.status} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="min-w-0 space-y-4">
          {!detail && <p className="text-sm text-neutral-500">Pick a task to see its thread and run log.</p>}
          {detail && (
            <>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{detail.task.title}</h2>
                  <Badge value={detail.task.status} />
                </div>
                {detail.task.body && <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">{detail.task.body}</p>}
                {detail.task.blocked_reason && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <span>{detail.task.blocked_reason}</span>
                    <Button variant="outline" className="h-7 px-2 text-xs" onClick={() => void api.retry(detail.task.id).then(() => loadTask(detail.task.id))}>
                      Back to todo
                    </Button>
                  </div>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Thread</h3>
                <ul className="space-y-2">
                  {detail.thread.length === 0 && <li className="text-sm text-neutral-500">Nothing yet.</li>}
                  {detail.thread.map((m) => (
                    <li key={m.id} className="rounded-md bg-neutral-50 px-3 py-2 text-sm">
                      <div className="mb-1 text-xs text-neutral-500">
                        {m.from_id}
                        {m.to_id ? ` → ${m.to_id}` : ''} · {new Date(m.created_at).toLocaleString()}
                      </div>
                      <div className="whitespace-pre-wrap">{m.body}</div>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Run log {runId ? <span className="font-normal text-neutral-500">· {runId.slice(0, 8)}</span> : null}</h3>
                <RunLog run={run ?? undefined} events={ordered} />
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
