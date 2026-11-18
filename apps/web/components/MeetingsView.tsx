'use client';

import { useEffect, useState } from 'react';
import { API, api, type Meeting } from '../lib/api';

export interface MeetingsClient {
  meetings(): Promise<Meeting[]>;
}

const real: MeetingsClient = { meetings: api.meetings };

const STATUS: Record<string, string> = { planned: 'Planned', open: 'Room open', closed: 'Over', cancelled: 'Cancelled' };

/** The client meetings (S10-3, S10-7): when, what state the room is in, and how many guest links are live. Text is shown as text; a guest link is never shown here, only counted. */
export function MeetingsView({ client = real }: { client?: MeetingsClient }) {
  const [rows, setRows] = useState<Meeting[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    client.meetings().then(
      (got) => {
        if (alive) setRows(got);
      },
      (err: Error) => {
        if (alive) setError(`Cannot reach the server at ${API}. Is \`pnpm dev\` running? (${err.message})`);
      },
    );
    return () => {
      alive = false;
    };
  }, [client]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!rows) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!rows.length) return <p className="text-sm text-slate-500">No client meetings yet. An invite is asked for by an agent and goes out only after you approve it.</p>;
  return (
    <div className="space-y-3">
      {rows.map((m) => (
        <article key={m.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-semibold">{m.title}</h3>
            <span className={m.status === 'open' ? 'text-green-700' : m.status === 'cancelled' ? 'text-red-700' : 'text-slate-600'}>{STATUS[m.status] ?? m.status}</span>
          </div>
          <p className="text-xs text-slate-500">
            {new Date(m.startsAt).toLocaleString()} · {m.invites} live guest link{m.invites === 1 ? '' : 's'}
            {m.dealId ? ' · on a deal' : ''}
          </p>
        </article>
      ))}
    </div>
  );
}
