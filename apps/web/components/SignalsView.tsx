'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API, api, type Signal } from '../lib/api';
import { Button } from './ui/button';

export interface SignalsClient {
  signals(status?: string): Promise<Signal[]>;
  qualify(id: string): Promise<unknown>;
  dismiss(id: string): Promise<unknown>;
  promote(id: string): Promise<unknown>;
}

const real: SignalsClient = { signals: api.signals, qualify: api.qualifySignal, dismiss: api.dismissSignal, promote: api.promoteSignal };

const TABS = [
  { status: 'qualified', label: 'Qualified' },
  { status: 'new', label: 'New' },
  { status: 'dismissed', label: 'Dismissed' },
  { status: 'promoted', label: 'Promoted' },
] as const;

const KIND: Record<string, string> = { service_request: 'Asking for our services', pain_point: 'A recurring problem', tool_news: 'Tool news' };

/** Only a real web address becomes a link; anything else stays plain text. */
const webAddress = (u: string) => /^https?:\/\//i.test(u) && URL.canParse(u);

/** What the scouts found (SPEC 3, 12): qualified signals first, with a person's decision on each. Their text is shown as text, never as markup. */
export function SignalsView({ client = real }: { client?: SignalsClient }) {
  const [tab, setTab] = useState<string>('qualified');
  const [rows, setRows] = useState<Signal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const load = useCallback(
    async (status: string) => {
      try {
        const got = await client.signals(status);
        setRows([...got].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)));
        setError(null);
      } catch (err) {
        setError(`Cannot reach the server at ${API}. Is \`pnpm dev\` running? (${(err as Error).message})`);
      }
    },
    [client],
  );
  useEffect(() => {
    setRows(null);
    void load(tab);
  }, [load, tab]);

  async function act(fn: () => Promise<unknown>) {
    if (busy.current) return;
    busy.current = true;
    try {
      await fn();
      await load(tab);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      busy.current = false;
    }
  }

  const label = TABS.find((t) => t.status === tab)!.label.toLowerCase();
  return (
    <section aria-labelledby="signals-title" className="space-y-4">
      <h1 id="signals-title" className="text-xl font-semibold">
        Signals
      </h1>
      <div role="tablist" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.status} role="tab" aria-selected={t.status === tab} onClick={() => setTab(t.status)} className={`rounded-md border px-3 py-1.5 text-sm ${t.status === tab ? 'border-neutral-900 bg-neutral-100 font-medium' : 'border-neutral-300'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {rows === null && !error && <p className="text-sm text-neutral-500">Loading…</p>}
      {rows?.length === 0 && <p className="text-sm text-neutral-600">No {label} signals.</p>}
      <ul className="space-y-3">
        {rows?.map((s) => {
          const flagged = !!s.reason && /looked like instructions/i.test(s.reason);
          return (
            <li key={s.id}>
              <article className="space-y-2 rounded-md border border-neutral-200 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{s.author ?? 'Unknown author'}</span>
                  <span className="text-xs text-neutral-500">
                    {KIND[s.kind] ?? s.kind} · {s.source}
                    {s.score !== null && <> · score {s.score}</>}
                  </span>
                </div>
                {s.excerpt && <p className="whitespace-pre-wrap text-sm text-neutral-800">{s.excerpt}</p>}
                {s.reason && <p className={`text-xs ${flagged ? 'font-medium text-amber-800' : 'text-neutral-600'}`}>{flagged ? `Careful: ${s.reason}` : `Why: ${s.reason}`}</p>}
                {webAddress(s.url) && (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-sm underline">
                    Open the original
                  </a>
                )}
                {s.status === 'promoted' && <p className="text-xs text-green-800">This became a lead.</p>}
                {s.status !== 'promoted' && (
                  <div className="flex flex-wrap gap-2">
                    {s.status !== 'dismissed' && (
                      <Button onClick={() => void act(() => client.promote(s.id))}>Promote to a lead</Button>
                    )}
                    {s.status !== 'qualified' && (
                      <Button variant="outline" onClick={() => void act(() => client.qualify(s.id))}>
                        Qualify
                      </Button>
                    )}
                    {s.status !== 'dismissed' && (
                      <Button variant="outline" onClick={() => void act(() => client.dismiss(s.id))}>
                        Dismiss
                      </Button>
                    )}
                  </div>
                )}
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
