'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { API, api, type Brief } from '../lib/api';
import { Button } from './ui/button';

export interface BriefClient {
  brief(): Promise<Brief | null>;
  rebuild(): Promise<Brief>;
}

const real: BriefClient = { brief: api.brief, rebuild: api.rebuildBrief };

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-md border border-neutral-200 p-3">
      <h2 className="text-sm font-semibold text-neutral-700">{title}</h2>
      {children}
    </section>
  );
}

function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-1 text-sm text-neutral-800">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

/** The morning brief (SPEC 3, 12): counted from the tables, with the chief of staff's paragraph apart from the counts. */
export function BriefView({ client = real }: { client?: BriefClient }) {
  const [brief, setBrief] = useState<Brief | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setBrief(await client.brief());
      setError(null);
    } catch (err) {
      setError(`Cannot reach the server at ${API}. Is \`pnpm dev\` running? (${(err as Error).message})`);
    }
  }, [client]);
  useEffect(() => {
    void load();
  }, [load]);

  async function rebuild() {
    if (busy) return;
    setBusy(true);
    try {
      setBrief(await client.rebuild());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const c = brief?.content;
  return (
    <section aria-labelledby="brief-title" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 id="brief-title" className="text-xl font-semibold">
          Morning brief
        </h1>
        {brief !== undefined && (
          <Button variant="outline" onClick={() => void rebuild()} disabled={busy}>
            {brief ? 'Count again' : "Make today's brief"}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {brief === undefined && !error && <p className="text-sm text-neutral-500">Loading…</p>}
      {brief === null && <p className="text-sm text-neutral-600">There is no brief yet. It is made each morning; you can make today&apos;s now.</p>}
      {brief && c && (
        <>
          <p className="text-xs text-neutral-500">
            For {brief.day} · counted at {new Date(brief.updated_at).toLocaleTimeString()}
          </p>
          <ul aria-label="summary" className="space-y-1 rounded-md bg-neutral-50 p-3 text-sm font-medium text-neutral-900">
            {brief.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          {brief.narrative && (
            <div data-note className="space-y-1 rounded-md border border-blue-200 bg-blue-50 p-3">
              <p className="whitespace-pre-wrap text-sm text-neutral-900">{brief.narrative}</p>
              <p className="text-xs text-neutral-600">Written by {brief.narrative_by?.replace(/^agent:/, '') ?? 'an agent'}. This paragraph is its reading of the numbers, not counted.</p>
            </div>
          )}

          {c.attention.kill_switch && <Part title="The kill switch is on"><p className="text-sm">Nothing is running and nothing will be sent until it is turned off.</p></Part>}

          {c.approvals.waiting > 0 && (
            <Part title={`Approvals waiting (${c.approvals.waiting})`}>
              <List items={c.approvals.items.map((a) => a.label)} />
            </Part>
          )}
          {c.replies.to_triage > 0 && (
            <Part title={`Replies to triage (${c.replies.to_triage})`}>
              <List items={c.replies.items.map((t) => t.title)} />
            </Part>
          )}
          {(c.attention.blocked.length > 0 || c.attention.action_items.length > 0) && (
            <Part title="Needs you">
              <List items={[...c.attention.blocked.map((t) => <span key={t.task_id}><strong>{t.title}</strong>{t.reason ? `: ${t.reason}` : ''}</span>), ...c.attention.action_items.map((a) => a.title)]} />
            </Part>
          )}
          {c.deals.stuck > 0 && (
            <Part title={`Stuck deals (${c.deals.stuck})`}>
              <List items={c.deals.items.map((d) => `${d.account}, in ${d.stage} for ${d.days} days`)} />
            </Part>
          )}
          {c.leads.new > 0 && (
            <Part title={`New leads (${c.leads.new})`}>
              <List items={c.leads.top.map((l) => <span key={l.id}><strong>{l.name ?? 'Unnamed'}</strong> · {l.score}{l.reason ? ` · ${l.reason}` : ''}</span>)} />
              {c.leads.top.length === 0 && <p className="text-sm text-neutral-500">None scored yet.</p>}
            </Part>
          )}
          {c.goals.rungs.length > 0 && (
            <Part title="Goals">
              <List items={c.goals.rungs.map((g) => `${g.title ?? g.key}: ${g.current !== null ? g.current : 'not measured'}${g.target ? ` of ${g.target}` : ''}${g.pct !== null ? ` · ${g.pct}%` : ''}`)} />
            </Part>
          )}
        </>
      )}
    </section>
  );
}
