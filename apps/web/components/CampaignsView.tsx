'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API, api, type CampaignAction, type CampaignResults, type CampaignRow } from '../lib/api';
import { Button } from './ui/button';

export interface CampaignsClient {
  campaigns(): Promise<CampaignRow[]>;
  results(id: string): Promise<CampaignResults>;
  act(id: string, action: CampaignAction): Promise<{ id: string; status: string }>;
}

const real: CampaignsClient = { campaigns: api.campaigns, results: api.campaignResults, act: api.campaignAction };

/** The one next step for each status. Approving is the founder's decision; nothing runs before it. */
const NEXT: Record<string, { label: string; action: CampaignAction } | undefined> = {
  draft: { label: 'Approve campaign', action: 'approve' },
  approved: { label: 'Start', action: 'start' },
  paused: { label: 'Start', action: 'start' },
  running: { label: 'Pause', action: 'pause' },
};

const dash = 'not tracked';
const num = (v: number | null) => (v === null ? dash : String(v));

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-neutral-50 p-2">
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="text-sm font-semibold">{value}</dd>
    </div>
  );
}

function Detail({ client, c, onChanged }: { client: CampaignsClient; c: CampaignRow; onChanged: () => void }) {
  const [r, setR] = useState<CampaignResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let alive = true;
    client.results(c.id).then(
      (x) => alive && setR(x),
      (err: Error) => alive && setError(err.message),
    );
    return () => {
      alive = false;
    };
  }, [client, c.id, c.status]);

  async function act(a: CampaignAction) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await client.act(c.id, a);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const next = NEXT[c.status];
  return (
    <div className="space-y-3 border-t border-neutral-200 p-3">
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {next && (
          <Button onClick={() => void act(next.action)} disabled={busy}>
            {next.label}
          </Button>
        )}
        {(c.status === 'approved' || c.status === 'running' || c.status === 'paused') && (
          <Button variant="outline" onClick={() => void act('finish')} disabled={busy}>
            Finish
          </Button>
        )}
      </div>
      {c.status === 'draft' && <p className="text-xs text-neutral-500">Nothing is sent until you approve it. Once approved, its steps cannot be changed.</p>}
      {r && (
        <section aria-label="Results">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Enrolled" value={String(r.enrolled)} />
            <Stat label="Sent" value={String(r.sent)} />
            <Stat label="Replied" value={String(r.replied)} />
            <Stat label="Positive" value={String(r.positive_replies)} />
            <Stat label="Reply rate" value={r.reply_rate === null ? '–' : `${Math.round(r.reply_rate * 100)}%`} />
            <Stat label="Won" value={String(r.won)} />
            <Stat label="Delivered" value={num(r.delivered)} />
            <Stat label="Opened" value={num(r.opened)} />
            <Stat label="Meetings" value={num(r.meetings)} />
            <Stat label="Run cost" value={`$${r.cost_usd.toFixed(2)}`} />
          </dl>
          <p className="mt-2 text-xs text-neutral-500">
            {r.enrollment.active} active · {r.enrollment.paused} paused · {r.enrollment.unsubscribed} unsubscribed · {r.enrollment.done} done
          </p>
        </section>
      )}
    </div>
  );
}

/** Campaigns (SPEC 10, 12): status, results, and the founder's approve, start and pause. */
export function CampaignsView({ client = real }: { client?: CampaignsClient }) {
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await client.campaigns());
      setError(null);
    } catch (err) {
      setError(`Cannot reach the server at ${API}. Is \`pnpm dev\` running? (${(err as Error).message})`);
    }
  }, [client]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section aria-labelledby="campaigns-title" className="space-y-4">
      <h1 id="campaigns-title" className="text-xl font-semibold">
        Campaigns
      </h1>
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {!rows && !error && <p className="text-sm text-neutral-500">Loading…</p>}
      {rows && rows.length === 0 && <p className="text-sm text-neutral-600">No campaigns yet.</p>}
      {rows && rows.length > 0 && (
        <ul aria-label="campaigns" className="space-y-2">
          {rows.map((c) => (
            <li key={c.id} className="rounded-md border border-neutral-200">
              <button type="button" className="flex w-full flex-col gap-1 p-3 text-left" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{c.name}</span>
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700">{c.status}</span>
                </span>
                <span className="text-sm text-neutral-600">
                  {c.channel} · {c.channel_handle ?? 'no mailbox'} · {c.steps} {c.steps === 1 ? 'step' : 'steps'}
                </span>
              </button>
              {open === c.id && <Detail client={client} c={c} onChanged={() => void refresh()} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
