'use client';

import { useEffect, useState } from 'react';
import { API, api, type Deployment } from '../lib/api';

export interface DeploymentsClient {
  deployments(): Promise<Deployment[]>;
}

const real: DeploymentsClient = { deployments: api.deployments };

const STATUS: Record<string, string> = { live: 'Live', failed: 'Failed', building: 'Building' };

/** Only a preview on this machine becomes a link: the deployer serves on 127.0.0.1, and nothing else is ever opened from here. */
const previewLink = (u: string | null) => (u && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(u) && URL.canParse(u) ? u : null);

/** Every deployment (SPEC 3, 12): the client, the project, whether it is live, the commit, who approved it, and a link to the preview. Text is shown as text. */
export function DeploymentsView({ client = real }: { client?: DeploymentsClient }) {
  const [rows, setRows] = useState<Deployment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    client.deployments().then(
      (got) => {
        if (alive) {
          setRows(got);
          setError(null);
        }
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
  if (!rows.length) return <p className="text-sm text-slate-500">Nothing has been deployed yet. A deploy is asked for by an engineer and goes live only after you approve it.</p>;
  return (
    <div className="space-y-3">
      {rows.map((d) => {
        const link = previewLink(d.url);
        return (
          <article key={d.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-semibold">{d.projectKey}</h3>
              <span className={d.status === 'live' ? 'text-green-700' : d.status === 'failed' ? 'text-red-700' : 'text-amber-700'}>{STATUS[d.status] ?? d.status}</span>
            </div>
            {d.client ? <p className="text-slate-600">{d.client}</p> : null}
            <p className="text-xs text-slate-500">
              {d.ref ? `Commit ${d.ref.slice(0, 8)} · ` : ''}Approved by {d.approvedBy} · {new Date(d.finishedAt ?? d.createdAt).toLocaleString()}
            </p>
            {d.status === 'failed' && d.error ? <pre className="mt-2 whitespace-pre-wrap rounded bg-red-50 p-2 text-xs text-red-800">{d.error}</pre> : null}
            {link ? (
              <a className="mt-2 inline-block text-blue-700 underline" href={link} target="_blank" rel="noreferrer">
                Open preview
              </a>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
