'use client';

import { useEffect, useState } from 'react';
import { API, api, type Board } from '../lib/api';

export interface BoardsClient {
  boards(): Promise<Board[]>;
}

const real: BoardsClient = { boards: api.boards };

const COLUMNS: { status: string; title: string }[] = [
  { status: 'todo', title: 'To do' },
  { status: 'in_progress', title: 'In progress' },
  { status: 'waiting_approval', title: 'Waiting for you' },
  { status: 'blocked', title: 'Blocked' },
  { status: 'done', title: 'Done' },
];
const TONE: Record<string, string> = { todo: 'bg-yellow-100', in_progress: 'bg-blue-100', waiting_approval: 'bg-amber-100', blocked: 'bg-red-100', done: 'bg-green-100' };

/** The boards (jsm-hq's boards modal): a tab for each goal, then the tasks of that goal in a column for where they are. Text is shown as text. */
export function BoardsView({ client = real }: { client?: BoardsClient }) {
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    let alive = true;
    client.boards().then(
      (b) => alive && setBoards(b),
      (err: Error) => alive && setError(`Cannot reach the server at ${API}. Is \`pnpm dev\` running? (${err.message})`),
    );
    return () => {
      alive = false;
    };
  }, [client]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!boards) return <p className="text-sm text-slate-500">Loading…</p>;
  const shown = boards.filter((b) => b.tasks.length > 0 || b.id !== null);
  const board = shown[Math.min(tab, Math.max(0, shown.length - 1))];
  if (!board) return <p className="text-sm text-slate-500">No tasks yet.</p>;
  return (
    <div className="space-y-3 text-sm">
      <div role="tablist" aria-label="Boards" className="flex flex-wrap gap-1">
        {shown.map((b, i) => (
          <button key={b.key} type="button" role="tab" aria-selected={board === b} onClick={() => setTab(i)} className={`rounded border px-2 py-1 ${board === b ? 'border-slate-700 bg-slate-100 font-medium' : 'border-slate-300'}`}>
            {b.title} <span className="text-xs text-slate-500">({b.tasks.length})</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        {board.id === null ? 'Tasks that serve no goal.' : `A ${board.kind} goal, ${board.status}.`}
      </p>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
        {COLUMNS.map((col) => {
          const rows = board.tasks.filter((t) => t.status === col.status);
          return (
            <section key={col.status} role="region" aria-label={col.title} className="space-y-1">
              <h3 className="text-xs font-semibold uppercase text-slate-500">
                {col.title} ({rows.length})
              </h3>
              {rows.map((t) => (
                <article key={t.id} className={`rounded p-2 ${TONE[col.status] ?? 'bg-slate-100'}`}>
                  <p>{t.title}</p>
                  {t.assignee ? <p className="text-xs text-slate-600">{t.assignee}</p> : null}
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
