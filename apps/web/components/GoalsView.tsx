'use client';

import { useEffect, useState } from 'react';
import { API, api, type DepartmentGoal, type GoalsData, type RungGoal } from '../lib/api';

export interface GoalsClient {
  goals(): Promise<GoalsData>;
}

const n = (v: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(v);
const money = (v: number, unit: string | null) => (unit === 'usd' ? `$${n(v)}` : n(v));

function Bar({ pct, label }: { pct: number; label: string }) {
  const shown = Math.max(0, Math.min(100, pct));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown)} className="h-2 w-full overflow-hidden rounded bg-neutral-100">
      <div className="h-full bg-neutral-900" style={{ width: `${shown}%` }} />
    </div>
  );
}

function Rung({ g, current }: { g: RungGoal; current: boolean }) {
  return (
    <div className="space-y-2 rounded-md border border-neutral-200 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">{g.title ?? g.key}</h3>
        <span className="flex items-center gap-2 text-xs text-neutral-500">
          {current && <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-white">current</span>}
          {g.met && <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-800">met</span>}
          {g.due && <span>by {g.due}</span>}
        </span>
      </div>
      {g.measured && g.current !== null && g.pct !== null ? (
        <>
          <Bar pct={g.pct} label={`${g.title ?? g.key} progress`} />
          <p className="text-sm text-neutral-700">
            {money(g.current, g.unit)} of {g.target !== null ? money(g.target, g.unit) : '?'} · {n(g.pct)}%{g.window ? ` · ${g.window}` : ''}
          </p>
        </>
      ) : (
        <p className="text-sm text-neutral-500">Not measured.</p>
      )}
    </div>
  );
}

function Dept({ g }: { g: DepartmentGoal }) {
  return (
    <div className="space-y-2 rounded-md border border-neutral-200 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">{g.department ?? g.key}</h3>
        <span className="text-xs text-neutral-500">{g.metric?.replace(/_/g, ' ')}</span>
      </div>
      {g.measured && g.current !== null ? (
        <>
          {g.pct !== null && <Bar pct={g.pct} label={`${g.department ?? g.key} progress`} />}
          <p className="text-sm text-neutral-700">
            {g.target !== null ? `${n(g.current)} of ${n(g.target)}` : n(g.current)} {g.unit ?? ''}
            {g.window ? ` · last ${g.window}` : ''}
            {g.serves ? ` · serves ${g.serves}` : ''}
          </p>
        </>
      ) : (
        <p className="text-sm text-neutral-500">Not measured: nothing in the tables counts &ldquo;{g.metric}&rdquo; yet.</p>
      )}
    </div>
  );
}

/** The Goals screen (SPEC 3, 12): the ladder and each department's goal, with progress measured from the tables. Read-only. */
export function GoalsView({ client = api }: { client?: GoalsClient }) {
  const [data, setData] = useState<GoalsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    client.goals().then(
      (d) => alive && (setData(d), setError(null)),
      (err: Error) => alive && setError(`Cannot reach the server at ${API}. Is \`pnpm dev\` running? (${err.message})`),
    );
    return () => {
      alive = false;
    };
  }, [client]);

  const empty = data && data.rungs.length === 0 && data.departments.length === 0;
  return (
    <section aria-labelledby="goals-title" className="space-y-6">
      <h1 id="goals-title" className="text-xl font-semibold">
        Goals
      </h1>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {!data && !error && <p className="text-sm text-neutral-500">Loading…</p>}
      {empty && <p className="text-sm text-neutral-600">There are no goals yet.</p>}
      {data && data.rungs.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-600">The ladder</h2>
          <ul aria-label="goal ladder" className="space-y-3">
            {data.rungs.map((g) => (
              <li key={g.key}>
                <Rung g={g} current={g.key === data.current_rung} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {data && data.departments.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-600">By department</h2>
          <ul aria-label="department goals" className="space-y-3">
            {data.departments.map((g) => (
              <li key={g.key}>
                <Dept g={g} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {data && <p className="text-xs text-neutral-500">Numbers are counted from the tables. To change a goal or a target, edit company/goals.yaml and restart.</p>}
    </section>
  );
}
