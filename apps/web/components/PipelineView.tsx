'use client';

import { useEffect, useState } from 'react';
import { API, api, type PipelineData } from '../lib/api';

export interface PipelineClient {
  pipeline(): Promise<PipelineData[]>;
}

const WAITING_FOR: Record<string, string> = { decision_maker: 'a named decision-maker', due: 'a date' };
const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`);
const days = (v: number | null) => (v === null ? '–' : String(Math.round(v * 10) / 10));

/** The pipeline (SPEC 10, 12): deals by funnel stage, with conversion, days in stage and the deals that are stuck. */
export function PipelineView({ client = api }: { client?: PipelineClient }) {
  const [funnels, setFunnels] = useState<PipelineData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [which, setWhich] = useState(0);

  useEffect(() => {
    let alive = true;
    client.pipeline().then(
      (d) => alive && (setFunnels(d), setError(null)),
      (err: Error) => alive && setError(`Cannot reach the server at ${API}. Is \`pnpm dev\` running? (${err.message})`),
    );
    return () => {
      alive = false;
    };
  }, [client]);

  const f = funnels?.[which];
  return (
    <section aria-labelledby="pipeline-title" className="space-y-4">
      <h1 id="pipeline-title" className="text-xl font-semibold">
        Pipeline
      </h1>
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {!funnels && !error && <p className="text-sm text-neutral-500">Loading…</p>}
      {funnels && funnels.length === 0 && <p className="text-sm text-neutral-600">No funnels yet. They are defined in company/funnels.yaml.</p>}
      {funnels && funnels.length > 1 && (
        <div role="tablist" className="flex flex-wrap gap-2">
          {funnels.map((x, i) => (
            <button key={x.funnel} role="tab" aria-selected={i === which} onClick={() => setWhich(i)} className={`rounded-md border px-3 py-1.5 text-sm ${i === which ? 'border-neutral-900 bg-neutral-100 font-medium' : 'border-neutral-300'}`}>
              {x.name}
            </button>
          ))}
        </div>
      )}
      {f && (
        <>
          <p className="text-sm text-neutral-700">
            {f.totals.open} open · {f.totals.won} won · {f.totals.lost} lost
          </p>
          <div className="overflow-x-auto">
            <table aria-label={f.name} className="w-full min-w-[32rem] text-left text-sm">
              <thead className="text-xs text-neutral-500">
                <tr>
                  <th className="py-1 pr-2 font-medium">Stage</th>
                  <th className="py-1 pr-2 font-medium">Now</th>
                  <th className="py-1 pr-2 font-medium">Reached</th>
                  <th className="py-1 pr-2 font-medium">Moved on</th>
                  <th className="py-1 pr-2 font-medium">Avg days</th>
                  <th className="py-1 font-medium">Median days</th>
                </tr>
              </thead>
              <tbody>
                {f.stages.map((s) => (
                  <tr key={s.key} className="border-t border-neutral-200">
                    <td className="py-1.5 pr-2">{s.name}</td>
                    <td className="py-1.5 pr-2">{s.current}</td>
                    <td className="py-1.5 pr-2">{s.reached}</td>
                    <td className="py-1.5 pr-2">{pct(s.conversion)}</td>
                    <td className="py-1.5 pr-2">{days(s.avg_days)}</td>
                    <td className="py-1.5">{days(s.median_days)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-neutral-500">Reached counts deals that got that far or further. Moved on is the share of those that reached the next stage.</p>
          {f.stuck.length > 0 ? (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-neutral-700">Stuck for more than {f.stuck_after_days} days</h2>
              <ul aria-label="stuck deals" className="space-y-1 text-sm">
                {f.stuck.map((d) => (
                  <li key={d.deal_id} className="rounded-md border border-amber-200 bg-amber-50 p-2">
                    <strong>{d.account}</strong> · {d.stage} · {Math.round(d.days_in_stage)} days
                    {d.missing.length > 0 && <span> · waiting for {d.missing.map((m) => WAITING_FOR[m] ?? m).join(' and ')}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-neutral-600">No deals are stuck.</p>
          )}
        </>
      )}
    </section>
  );
}
