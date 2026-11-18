'use client';

import { useEffect, useState } from 'react';
import { API, api, type Scorecard, type TalentRoom } from '../lib/api';

export interface TalentClient {
  talent(): Promise<TalentRoom>;
  scorecards(): Promise<Scorecard[]>;
}

const real: TalentClient = { talent: api.talent, scorecards: api.scorecards };

const MOVE: Record<string, string> = { skill_patch: 'Suggest a skill patch', different_persona: 'Try a different persona', bench: 'Bench it' };

/** The Talent room (S8-8): the hiring policy and roster, the latest bake-offs and hire cards, what is in the catalog, and the weekly scorecards. Text is shown as text. */
export function TalentView({ client = real }: { client?: TalentClient }) {
  const [room, setRoom] = useState<TalentRoom | null>(null);
  const [cards, setCards] = useState<Scorecard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([client.talent(), client.scorecards()]).then(
      ([r, c]) => {
        if (alive) {
          setRoom(r);
          setCards(c);
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
  if (!room || !cards) return <p className="text-sm text-slate-500">Loading…</p>;
  const p = room.policy;
  return (
    <div className="space-y-6 text-sm">
      <section aria-label="Hiring policy">
        <h3 className="font-semibold">Hiring</h3>
        <p>
          Level <strong>{p.level}</strong>
          {p.level === 'H0' ? ' (every hire comes to you)' : ' (a hire inside the mandate starts on trial by itself)'} · {p.active} of {p.rosterCap} active agents · trial budget up to ${p.trialBudgetCapUsd}
        </p>
      </section>

      <section aria-label="Bake-offs">
        <h3 className="font-semibold">Bake-offs</h3>
        {room.bakeoffs.length === 0 ? <p className="text-slate-500">No bake-off has run yet.</p> : null}
        {room.bakeoffs.map((b) => (
          <article key={b.id} className="mb-2 rounded border border-slate-200 bg-white p-2">
            <p>
              {b.department}: “{b.query}” · {b.status}
            </p>
            <ol className="ml-4 list-decimal">
              {b.candidates.map((c) => (
                <li key={`${c.source}/${c.key}`}>
                  {c.name} · rating {c.rating} · {c.boundaryAttempts ? `${c.boundaryAttempts} boundary attempt${c.boundaryAttempts === 1 ? '' : 's'}` : 'no boundary attempts'} · ${c.costUsd}
                </li>
              ))}
            </ol>
          </article>
        ))}
      </section>

      <section aria-label="Hires">
        <h3 className="font-semibold">Hire cards</h3>
        {room.hires.length === 0 ? <p className="text-slate-500">Nobody is proposed for hire.</p> : null}
        <ul>
          {room.hires.map((h) => (
            <li key={h.approvalId}>
              {h.name ?? 'A candidate'} → {h.department ?? 'a department'} · {h.status}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Catalog">
        <h3 className="font-semibold">Catalog</h3>
        {room.catalog.length === 0 ? <p className="text-slate-500">Nothing is imported yet.</p> : null}
        <ul>
          {room.catalog.map((s) => (
            <li key={s.source}>
              {s.source}: {s.roles} roles{s.flagged ? `, ${s.flagged} flagged and kept out of search` : ''}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Scorecards">
        <h3 className="font-semibold">This week</h3>
        {cards.length === 0 ? <p className="text-slate-500">No active agents yet.</p> : null}
        {cards.map((c) => (
          <article key={c.agentKey} className="mb-2 rounded border border-slate-200 bg-white p-2">
            <p className="font-medium">
              {c.name} <span className="text-slate-500">({c.department ?? 'no department'})</span>
            </p>
            <p>
              {c.tasksDone} tasks done · {c.checksPassed} of {c.runs} runs passed checks · {c.acceptedAsIs} accepted as is, {c.edited} edited, {c.rejected} rejected · ${c.costUsd}
              {c.costPerAccepted !== null ? ` ($${c.costPerAccepted} per accepted)` : ''} · {c.boundaryAttempts} boundary attempts
            </p>
            {c.suggestion ? (
              <p className="text-amber-700">
                {MOVE[c.suggestion.move] ?? c.suggestion.move}: {c.suggestion.why}
              </p>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  );
}
