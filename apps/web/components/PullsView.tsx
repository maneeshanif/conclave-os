'use client';

import { useEffect, useState } from 'react';
import { API, api, type PullRequest } from '../lib/api';

export interface PullsClient {
  pulls(): Promise<PullRequest[]>;
}

const real: PullsClient = { pulls: api.pulls };

const STATUS: Record<string, string> = { open: 'Open', merged: 'Merged', closed: 'Closed' };
const MERGE: Record<string, string> = { pending: 'A merge is waiting for your yes', approved: 'Merge approved', executing: 'Merging now', executed: 'Merged', rejected: 'You rejected the merge', failed: 'The merge failed' };

/** Pull requests (jsm-hq's PR drawer): who wrote it, its branch, whether its tests passed, who approved opening it, and where a merge stands. Text is shown as text; a link is shown only if it is a web address. */
export function PullsView({ client = real }: { client?: PullsClient }) {
  const [rows, setRows] = useState<PullRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    client.pulls().then(
      (got) => alive && setRows(got),
      (err: Error) => alive && setError(`Cannot reach the server at ${API}. Is \`pnpm dev\` running? (${err.message})`),
    );
    return () => {
      alive = false;
    };
  }, [client]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!rows) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!rows.length) return <p className="text-sm text-slate-500">No pull requests yet. A coder proposes one when its tests pass, and it opens only after you approve it.</p>;
  return (
    <div className="space-y-3">
      {rows.map((p) => (
        <article key={p.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-semibold">
              {p.project} #{p.number}: {p.title}
            </h3>
            <span className={p.status === 'merged' ? 'text-purple-700' : p.status === 'open' ? 'text-green-700' : 'text-slate-600'}>{STATUS[p.status] ?? p.status}</span>
          </div>
          <p className="text-slate-700">{p.summary}</p>
          <p className="text-xs text-slate-500">
            {p.branch} into {p.base} · commit {p.head} · tests {p.testsPassed ? 'passed' : 'not shown as passed'} · opened by your yes ({p.approvedBy}){p.mergedBy ? ` · merged by ${p.mergedBy}` : ''}
          </p>
          {p.mergeRequest ? <p className="text-xs text-slate-500">{MERGE[p.mergeRequest] ?? p.mergeRequest}</p> : null}
          {p.url && /^https:\/\//.test(p.url) && URL.canParse(p.url) ? (
            <a className="text-blue-700 underline" href={p.url} target="_blank" rel="noreferrer">
              Open on the host
            </a>
          ) : null}
        </article>
      ))}
    </div>
  );
}
