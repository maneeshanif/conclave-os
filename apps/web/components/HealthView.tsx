'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { API, api, type HealthOverview } from '../lib/api';
import { Button } from './ui/button';

export interface HealthClient {
  overview(): Promise<HealthOverview>;
  setKillSwitch(on: boolean): Promise<void>;
  resetBreaker(key: string): Promise<void>;
  liftPause(runtime: string): Promise<void>;
}

const real: HealthClient = { overview: api.health, setKillSwitch: api.setKillSwitch, resetBreaker: api.resetBreaker, liftPause: api.liftPause };

function Part({ title, children, tone }: { title: string; children: ReactNode; tone?: 'bad' }) {
  return (
    <section className={`space-y-2 rounded-md border p-3 ${tone === 'bad' ? 'border-red-300 bg-red-50' : 'border-neutral-200'}`}>
      <h2 className="text-sm font-semibold text-neutral-700">{title}</h2>
      {children}
    </section>
  );
}

const REASON: Record<string, string> = { paused: 'its usual engine hit a plan limit', retry: 'its usual engine kept failing', escalate: 'a check failed, so a stronger engine tried' };
const money = (n: number) => `$${n.toFixed(2)}`;
const size = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The Health screen (SPEC 12, 14): what is running, what is failing, what is switched off, and the kill switch. */
export function HealthView({ client = real }: { client?: HealthClient }) {
  const [o, setO] = useState<HealthOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setO(await client.overview());
      setError(null);
    } catch (err) {
      setError(`Cannot reach the server at ${API}. Is \`pnpm dev\` running? (${(err as Error).message})`);
    }
  }, [client]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const killOn = o?.killSwitch.on ?? false;
  const bad = o ? o.breakers.length > 0 || o.pauses.length > 0 || o.agents.some((a) => a.overBudget) || killOn : false;
  const ran = o ? o.agents.some((a) => a.runs > 0) : false;

  return (
    <section aria-labelledby="health-title" className="space-y-4">
      <h1 id="health-title" className="text-xl font-semibold">
        Health
      </h1>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {!o && !error && <p className="text-sm text-neutral-500">Loading…</p>}
      {o && (
        <>
          {!bad && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">Nothing needs attention.</p>}

          <Part title={killOn ? 'The kill switch is on' : 'Kill switch'} tone={killOn ? 'bad' : undefined}>
            <p className="text-sm text-neutral-800">
              {killOn ? 'Nothing is running and nothing will be sent until it is turned off.' : 'Stops every run and holds every send. Use it if something is going wrong.'}
            </p>
            {killOn ? (
              <Button variant="outline" disabled={busy} onClick={() => void act(() => client.setKillSwitch(false))}>
                Turn the kill switch off
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (window.confirm('Stop every run and hold every send?')) void act(() => client.setKillSwitch(true));
                }}
              >
                Turn the kill switch on
              </Button>
            )}
          </Part>

          {o.pauses.map((p) => (
            <Part key={p.runtime} title={`${p.label} is paused`} tone="bad">
              <p className="text-sm text-neutral-800">
                {p.reason}. It runs again at {new Date(p.until).toLocaleTimeString()}; work waits until then.
              </p>
              <Button variant="outline" disabled={busy} onClick={() => void act(() => client.liftPause(p.runtime))}>
                Lift pause
              </Button>
            </Part>
          ))}

          {o.breakers.map((b) => (
            <Part key={b.key} title="A tool is switched off" tone="bad">
              <p className="text-sm text-neutral-800">
                <strong>{b.key}</strong> failed {b.failures} times in a row{b.lastError ? `: ${b.lastError}` : ''}.{b.openUntil ? ` It is tried again at ${new Date(b.openUntil).toLocaleTimeString()}.` : ''}
              </p>
              <Button variant="outline" disabled={busy} aria-label={`Reset ${b.key}`} onClick={() => void act(() => client.resetBreaker(b.key))}>
                Reset
              </Button>
            </Part>
          ))}

          <Part title="Queue">
            <p aria-label="queue" className="text-sm text-neutral-800">
              {o.queue.todo} waiting · {o.queue.in_progress} running · {o.queue.blocked} blocked
            </p>
          </Part>

          <Part title={`Agents, last ${o.windowHours} hours`}>
            {!ran && <p className="text-sm text-neutral-500">No runs in the last {o.windowHours} hours.</p>}
            <ul className="space-y-2 text-sm">
              {o.agents.map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="font-medium">{a.name}</span>
                  <span className="text-neutral-600">
                    {a.runs ? `${plural(a.runs, 'run')}, ${a.failed} failed` : 'no runs'}
                    {a.failureRate !== null && <> · <span>{Math.round(a.failureRate * 100)}%</span></>}
                  </span>
                  <span className={a.overBudget ? 'font-medium text-red-700' : 'text-neutral-600'}>
                    {a.budget > 0 ? `${money(a.spentThisMonth)} of ${money(a.budget)} this month` : `${money(a.spentThisMonth)} this month, no budget`}
                    {a.overBudget && ' · over budget'}
                  </span>
                </li>
              ))}
            </ul>
          </Part>

          {o.reroutes.length > 0 && (
            <Part title="Moved to another engine">
              <ul className="space-y-1 text-sm text-neutral-800">
                {o.reroutes.map((r, i) => (
                  <li key={i}>
                    {r.agent} moved from {r.from} to {r.to} at {new Date(r.at).toLocaleTimeString()}: {REASON[r.reason] ?? r.reason}.
                  </li>
                ))}
              </ul>
            </Part>
          )}

          <Part title="Housekeeping">
            <p className="text-sm text-neutral-800">
              {o.reaper
                ? `Last check for stuck runs at ${new Date(o.reaper.at).toLocaleTimeString()}: failed ${plural(o.reaper.reaped, 'silent run')}, put back ${plural(o.reaper.requeued, 'task')}, blocked ${o.reaper.blocked}.`
                : 'The check for stuck runs has not run since the server started.'}
            </p>
            <p className="text-sm text-neutral-800">Database: {size(o.database.sizeBytes)}</p>
          </Part>
        </>
      )}
    </section>
  );
}
