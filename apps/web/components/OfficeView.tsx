'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { panelFor } from '@conclave/shared';
import { API, api, type AgentDrawer, type OfficeFacts, type OfficePlace } from '../lib/api';
import { socketEvents, type LiveMessage } from '../lib/live';
import { Button } from './ui/button';

export interface OfficeClient {
  office(): Promise<OfficeFacts>;
  state(): Promise<OfficePlace[]>;
  drawer(id: string): Promise<AgentDrawer>;
  message(id: string, text: string): Promise<void>;
  /** Listens for live updates; returns the function that stops listening. */
  live(onMessage: (m: LiveMessage) => void): () => void;
}

export const realOfficeClient: OfficeClient = { office: api.office, state: api.officeState, drawer: api.officeDrawer, message: api.officeMessage, live: socketEvents };

export const WHERE: Record<string, string> = { desk: 'At its desk', approvals: 'At the approvals desk', boardroom: 'In the Boardroom', lounge: 'In the lounge' };

/**
 * The plain office (SPEC 12): the same rooms, agents and objects as the world, as a list. It works on a phone, with a screen
 * reader and with no canvas, and it uses the same panel registry as the world, so the two always agree.
 */
export function OfficeView({ client = realOfficeClient, openId = null }: { client?: OfficeClient; /** An agent the world has walked up to; its drawer opens here. */ openId?: string | null }) {
  const [facts, setFacts] = useState<OfficeFacts | null>(null);
  const [places, setPlaces] = useState<OfficePlace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<AgentDrawer | null>(null);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);

  const loadState = useCallback(async () => {
    try {
      setPlaces(await client.state());
    } catch (err) {
      setError(`Cannot reach the server at ${API}. Is \`pnpm dev\` running? (${(err as Error).message})`);
    }
  }, [client]);

  useEffect(() => {
    void (async () => {
      try {
        setFacts(await client.office());
        setError(null);
        await loadState();
      } catch (err) {
        setError(`Cannot reach the server at ${API}. Is \`pnpm dev\` running? (${(err as Error).message})`);
      }
    })();
    return client.live((m) => {
      if (m.kind === 'office.changed') void loadState();
    });
  }, [client, loadState]);

  useEffect(() => {
    if (openId) void openDrawer(openId);
  }, [openId]);

  async function openDrawer(id: string) {
    setSent(false);
    setText('');
    try {
      setOpen(await client.drawer(id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function send() {
    if (!open || !text.trim()) return;
    try {
      await client.message(open.agent.id, text.trim());
      setText('');
      setSent(true);
      setOpen(await client.drawer(open.agent.id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (error && !facts) return <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>;
  if (!facts) return <p className="text-sm text-neutral-500">Loading the office…</p>;

  const placeOf = (agentId: string) => places.find((p) => p.agentId === agentId);
  const roomOf = (agentId: string) => facts.agents.find((a) => a.id === agentId)?.room ?? null;
  const here = (room: string) => facts.agents.filter((a) => (placeOf(a.id)?.place === 'desk' ? roomOf(a.id) === room : false));
  const elsewhere = (place: string) => facts.agents.filter((a) => placeOf(a.id)?.place === place);
  const agentButton = (a: OfficeFacts['agents'][number]) => (
    <li key={a.id}>
      <button type="button" onClick={() => void openDrawer(a.id)} className="w-full rounded-md border border-neutral-200 px-3 py-2 text-left text-sm hover:bg-neutral-50">
        <span className="font-medium">{a.name}</span>
        <span className="ml-2 text-neutral-500">
          {WHERE[placeOf(a.id)?.place ?? 'lounge']}. {placeOf(a.id)?.reason}
        </span>
      </button>
    </li>
  );
  const roomAgents = (room: { name: string; kind: string }) => {
    if (room.kind === 'boardroom') return elsewhere('boardroom');
    if (room.kind === 'lounge') return elsewhere('lounge');
    return here(room.name);
  };

  return (
    <div className="space-y-6">
      {error ? <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      <section aria-label="Things in the office" className="flex flex-wrap gap-2">
        {facts.map.objects.map((o) => {
          const panel = panelFor(o.type);
          if (!panel) return null;
          return panel.ready ? (
            <Link key={`${o.type}-${o.name}`} href={panel.href} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">
              {panel.label}
            </Link>
          ) : (
            <span key={`${o.type}-${o.name}`} className="rounded-md border border-dashed border-neutral-300 px-3 py-1.5 text-sm text-neutral-500">
              {panel.label} <span className="text-xs">(coming)</span>
            </span>
          );
        })}
      </section>

      {elsewhere('approvals').length ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-700">At the approvals desk</h2>
          <ul className="space-y-1">{elsewhere('approvals').map(agentButton)}</ul>
        </section>
      ) : null}

      {facts.map.rooms.map((r) => (
        <section key={r.name} className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-700">{r.name}</h2>
          {roomAgents(r).length ? <ul className="space-y-1">{roomAgents(r).map(agentButton)}</ul> : <p className="text-sm text-neutral-400">Nobody here.</p>}
        </section>
      ))}

      {open ? (
        <section role="region" aria-label={`${open.agent.name} drawer`} className="space-y-3 rounded-md border border-neutral-300 p-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{open.agent.name}</h3>
            <Button type="button" variant="outline" onClick={() => setOpen(null)}>
              Close
            </Button>
          </div>
          <p className="text-sm text-neutral-600">{open.run ? `Run ${open.run.status}.` : 'No run going.'}</p>
          {open.tasks.length ? (
            <ul className="list-disc pl-5 text-sm">
              {open.tasks.map((t) => (
                <li key={t.id}>{t.title}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-400">No open tasks.</p>
          )}
          <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label={`Message to ${open.agent.name}`} rows={3} className="w-full rounded-md border border-neutral-300 p-2 text-sm" />
          <div className="flex items-center gap-3">
            <Button type="button" disabled={!text.trim()} onClick={() => void send()}>
              Send
            </Button>
            {sent ? <span className="text-sm text-green-700">Sent. It is now a task for {open.agent.name}.</span> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
