'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type BoardroomDecision, type BoardroomDiscussion, type BoardroomTurn } from '../lib/api';
import { socketEvents, type LiveMessage } from '../lib/live';
import { Button } from './ui/button';

export interface BoardroomClient {
  discussions(): Promise<{ discussions: BoardroomDiscussion[] }>;
  discussion(id: string): Promise<{ discussion: BoardroomDiscussion; turns: BoardroomTurn[] }>;
  open(b: { kind: string; question: string; participants?: string[] }): Promise<unknown>;
  close(id: string): Promise<unknown>;
  decisions(): Promise<{ decisions: BoardroomDecision[] }>;
  decide(b: { title: string; decision: string; owner?: string; due?: string; discussionId?: string }): Promise<unknown>;
  agents(): Promise<{ key: string; name: string }[]>;
}
const real: BoardroomClient = {
  discussions: api.boardroomDiscussions,
  discussion: api.boardroomDiscussion,
  open: api.boardroomOpen,
  close: api.boardroomClose,
  decisions: api.boardroomDecisions,
  decide: api.boardroomDecide,
  agents: async () => (await api.agents()).filter((a) => a.status === 'active').map((a) => ({ key: a.key, name: a.name })),
};

const KINDS: Record<string, string> = { adhoc: 'Discussion', weekly: 'Weekly review', standup: 'Stand-up' };
const field = 'mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm';

/** What a turn cited, in words: "12 tasks where status = todo", or "leads record". The OS checked each one against its tables before keeping the turn. */
function cited(e: unknown): string {
  const x = e as { type?: string; table?: string; where?: { column: string; value: string }; claimed?: number };
  if (x.type === 'count') return `${x.claimed} ${x.table}${x.where ? ` where ${x.where.column} = ${x.where.value}` : ''}`;
  return `${x.table} record`;
}

/**
 * The Boardroom (SPEC 4, S6-10): the discussions you and the agents hold, where every turn cites numbers the OS has checked, and
 * the decision log, where only you record a decision. Nothing here lets an agent decide.
 */
export function BoardroomView({ client = real, onEvents = socketEvents }: { client?: BoardroomClient; onEvents?: (onMessage: (m: LiveMessage) => void) => () => void }) {
  const [list, setList] = useState<BoardroomDiscussion[] | null>(null);
  const [log, setLog] = useState<BoardroomDecision[] | null>(null);
  const [agents, setAgents] = useState<{ key: string; name: string }[]>([]);
  const [open, setOpen] = useState<{ discussion: BoardroomDiscussion; turns: BoardroomTurn[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openId = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, x] = await Promise.all([client.discussions(), client.decisions()]);
      setList(d.discussions);
      setLog(x.decisions);
      setFailed(false);
      if (openId.current) setOpen(await client.discussion(openId.current));
    } catch {
      setFailed(true);
    }
  }, [client]);
  useEffect(() => {
    void load();
    void client.agents().then(setAgents).catch(() => undefined);
    const off = onEvents((m) => {
      if (m.kind === 'discussion.changed') void load();
    });
    return off;
  }, [load, onEvents, client]);

  async function show(id: string) {
    openId.current = id;
    try {
      setOpen(await client.discussion(id));
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function close(id: string) {
    try {
      await client.close(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const [kind, setKind] = useState('adhoc');
  const [question, setQuestion] = useState('');
  const [who, setWho] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  async function submitOpen(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setFormError(null);
    try {
      await client.open({ kind, question: q, ...(who.length ? { participants: who } : {}) });
      setQuestion('');
      setWho([]);
      await load();
    } catch (err) {
      setFormError((err as Error).message);
    }
  }

  const [title, setTitle] = useState('');
  const [decision, setDecision] = useState('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const [decideError, setDecideError] = useState<string | null>(null);
  async function submitDecision(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !decision.trim()) return;
    setDecideError(null);
    try {
      await client.decide({ title: title.trim(), decision: decision.trim(), ...(owner.trim() ? { owner: owner.trim() } : {}), ...(due ? { due } : {}), ...(openId.current ? {} : {}) });
      setTitle('');
      setDecision('');
      setOwner('');
      setDue('');
      await load();
    } catch (err) {
      setDecideError((err as Error).message);
    }
  }

  if (failed && !list) return <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">Cannot load the Boardroom. Is the server running?</p>;
  if (!list || !log) return <p className="text-sm text-neutral-500">Loading…</p>;

  return (
    <div className="space-y-8">
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Discussions</h2>
        {list.length === 0 ? <p className="text-sm text-neutral-500">No discussions yet. Open one below.</p> : null}
        <ul aria-label="Discussions" className="space-y-2">
          {list.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => void show(d.id)} className="w-full rounded-md border border-neutral-200 px-3 py-2 text-left text-sm hover:bg-neutral-50">
                <span className="block font-medium">{d.question}</span>
                <span className="text-xs text-neutral-500">
                  {KINDS[d.kind] ?? d.kind} · {d.status === 'open' ? 'Open' : 'Closed'} · {d.turns} {d.turns === 1 ? 'turn' : 'turns'} · for {d.participants.length ? d.participants.join(', ') : 'everyone (any agent)'}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {open ? (
          <section role="region" aria-label="Discussion" className="space-y-3 rounded-md border border-neutral-300 p-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold">{open.discussion.question}</h3>
              {open.discussion.status === 'open' ? (
                <Button type="button" variant="outline" className="h-8 px-3 text-xs" onClick={() => void close(open.discussion.id)}>
                  Close discussion
                </Button>
              ) : (
                <span className="text-xs text-neutral-500">Closed</span>
              )}
            </div>
            {open.turns.length === 0 ? <p className="text-sm text-neutral-500">Nobody has taken a turn yet.</p> : null}
            <ul className="space-y-2">
              {open.turns.map((t) => (
                <li key={t.id} className="rounded-md bg-neutral-50 px-3 py-2 text-sm">
                  <div className="mb-1 text-xs text-neutral-500">
                    {t.speaker} · Round {t.round}
                  </div>
                  <p className="whitespace-pre-wrap">{t.body}</p>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {t.evidence.map((e, i) => (
                      <li key={i} className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-900" title="Checked against the tables when the turn was added">
                        ✓ {cited(e)}
                      </li>
                    ))}
                  </ul>
                  {t.disagreements ? <p className="mt-1 text-xs text-amber-800">Where they disagree: {t.disagreements}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <form aria-label="Open a discussion" onSubmit={(e) => void submitOpen(e)} className="space-y-2 rounded-md border border-neutral-200 p-3">
          <h3 className="text-sm font-semibold">Open a discussion</h3>
          <label className="block text-xs text-neutral-600">
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value)} className={field}>
              {Object.entries(KINDS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-neutral-600">
            Question
            <textarea value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={2000} rows={2} className={field} />
          </label>
          {agents.length ? (
            <fieldset className="space-y-1">
              <legend className="text-xs text-neutral-600">For (leave empty for everyone)</legend>
              {agents.map((a) => (
                <label key={a.key} className="mr-3 inline-flex items-center gap-1 text-sm">
                  <input type="checkbox" checked={who.includes(a.key)} onChange={(e) => setWho(e.target.checked ? [...who, a.key] : who.filter((k) => k !== a.key))} />
                  {a.name}
                </label>
              ))}
            </fieldset>
          ) : null}
          {formError ? <p className="text-xs text-red-700">{formError}</p> : null}
          <Button type="submit" disabled={!question.trim()}>
            Open
          </Button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Decision log</h2>
        {log.length === 0 ? <p className="text-sm text-neutral-500">No decisions recorded yet.</p> : null}
        <ul aria-label="Decision log" className="space-y-2">
          {log.map((d) => (
            <li key={d.id} className="rounded-md border border-neutral-200 px-3 py-2 text-sm">
              <span className="block font-medium">{d.title}</span>
              <span className="block whitespace-pre-wrap">{d.decision}</span>
              <span className="text-xs text-neutral-500">
                {d.decided_at.slice(0, 10)}
                {d.owner ? ` · owner: ${d.owner}` : ''}
                {d.due ? ` · by ${d.due}` : ''}
              </span>
            </li>
          ))}
        </ul>
        <form aria-label="Record a decision" onSubmit={(e) => void submitDecision(e)} className="space-y-2 rounded-md border border-neutral-200 p-3">
          <h3 className="text-sm font-semibold">Record a decision</h3>
          <p className="text-xs text-neutral-500">Only you can. Agents read the log before they propose something you have already decided.</p>
          <label className="block text-xs text-neutral-600">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={field} />
          </label>
          <label className="block text-xs text-neutral-600">
            Decision
            <textarea value={decision} onChange={(e) => setDecision(e.target.value)} maxLength={4000} rows={3} className={field} />
          </label>
          <div className="flex gap-2">
            <label className="block flex-1 text-xs text-neutral-600">
              Owner (optional)
              <input value={owner} onChange={(e) => setOwner(e.target.value)} maxLength={100} className={field} />
            </label>
            <label className="block text-xs text-neutral-600">
              Due (optional)
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={field} />
            </label>
          </div>
          {decideError ? <p className="text-xs text-red-700">{decideError}</p> : null}
          <Button type="submit" disabled={!title.trim() || !decision.trim()}>
            Record
          </Button>
        </form>
      </section>
    </div>
  );
}
