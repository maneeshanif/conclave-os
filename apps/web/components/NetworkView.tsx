'use client';

import { useEffect, useState } from 'react';
import { API, api, type NetworkPerson } from '../lib/api';

export interface NetworkClient {
  people(): Promise<NetworkPerson[]>;
  sentByYou(draftId: string, nudgeInDays?: number): Promise<unknown>;
}

const real: NetworkClient = { people: api.networkPeople, sentByYou: api.networkSentByYou };

const STATUS: Record<string, string> = { new: 'New', in_touch: 'In touch', dropped: 'Dropped' };

/** The Founder Network (S8-11b): people worth knowing, a note on each, and drafts for you to send yourself. The OS sends nothing; "I sent this myself" only records that you did. */
export function NetworkView({ client = real }: { client?: NetworkClient }) {
  const [rows, setRows] = useState<NetworkPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    client.people().then(
      (got) => setRows(got),
      (err: Error) => setError(`Cannot reach the server at ${API}. Is \`pnpm dev\` running? (${err.message})`),
    );
  useEffect(() => {
    void load();
  }, [client]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!rows) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!rows.length) return <p className="text-sm text-slate-500">Nobody in the network yet. The finders add founders worth knowing; you write to them yourself.</p>;
  return (
    <div className="space-y-3">
      {rows.map((p) => (
        <article key={p.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-semibold">{p.name}</h3>
            <span className="text-xs text-slate-500">{STATUS[p.status] ?? p.status}</span>
          </div>
          <p className="text-slate-700">{p.note}</p>
          <p className="text-xs text-slate-500">
            Found: {p.whereFound}
            {p.lastTouch ? ` · last touch ${new Date(p.lastTouch).toLocaleDateString()}` : ''}
            {p.nextNudge ? ` · nudge on ${p.nextNudge}` : ''}
          </p>
          {p.drafts.map((d) => (
            <div key={d.id} className="mt-2 rounded bg-slate-50 p-2">
              <p className="whitespace-pre-wrap">{d.text}</p>
              {d.status === 'draft' ? (
                <button
                  type="button"
                  disabled={busy}
                  className="mt-1 rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-white"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await client.sentByYou(d.id, 14);
                      await load();
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  I sent this myself
                </button>
              ) : (
                <p className="mt-1 text-xs text-slate-500">You sent this.</p>
              )}
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}
