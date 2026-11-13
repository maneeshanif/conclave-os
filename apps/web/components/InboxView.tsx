'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API, api, type ThreadDetail, type ThreadMessage, type ThreadSummary } from '../lib/api';
import { socketEvents, type LiveMessage } from '../lib/live';
import { Button } from './ui/button';
import { Textarea } from './ui/field';

export interface InboxClient {
  threads(): Promise<ThreadSummary[]>;
  thread(id: string): Promise<ThreadDetail>;
  recordReply(threadId: string, body: string): Promise<{ messageId: string }>;
  classify(messageId: string, c: 'positive' | 'neutral' | 'negative'): Promise<{ id: string }>;
}

const KINDS = ['positive', 'neutral', 'negative'] as const;
const label = (k: string) => k[0]!.toUpperCase() + k.slice(1);

function Message({ m, onClassify }: { m: ThreadMessage; onClassify: (id: string, c: (typeof KINDS)[number]) => void }) {
  const mine = m.direction === 'out';
  return (
    <li className={`rounded-md border p-3 text-sm ${mine ? 'border-neutral-200 bg-white' : 'border-blue-200 bg-blue-50'}`}>
      <p className="mb-1 text-xs text-neutral-500">
        {mine ? 'We sent' : 'They replied'} · {new Date(m.at).toLocaleString()}
        {m.subject ? ` · ${m.subject}` : ''}
      </p>
      {/* Text from outside is rendered as text only. */}
      <p className="whitespace-pre-wrap break-words text-neutral-900">{m.body}</p>
      {!mine && (
        <div className="mt-2 flex gap-2" role="group" aria-label="Mark this reply">
          {KINDS.map((k) => (
            <Button key={k} variant="outline" aria-pressed={m.classification === k} className={m.classification === k ? 'border-neutral-900 bg-neutral-100' : ''} onClick={() => onClassify(m.id, k)}>
              {label(k)}
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}

function Conversation({ client, id, onChanged }: { client: InboxClient; id: string; onChanged: () => void }) {
  const [t, setT] = useState<ThreadDetail | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setT(await client.thread(id));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [client, id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function classify(messageId: string, c: (typeof KINDS)[number]) {
    try {
      await client.classify(messageId, c);
      setT((prev) => (prev ? { ...prev, messages: prev.messages.map((m) => (m.id === messageId ? { ...m, classification: c } : m)) } : prev));
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function record() {
    const body = text.trim();
    if (!body || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await client.recordReply(id, body);
      setText('');
      setError(null);
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (!t) return error ? <p role="alert" className="text-sm text-red-800">{error}</p> : <p className="text-sm text-neutral-500">Loading…</p>;
  return (
    <div className="space-y-3 pt-2">
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <ul aria-label="messages" className="space-y-2">
        {t.messages.map((m) => (
          <Message key={m.id} m={m} onClassify={(mid, c) => void classify(mid, c)} />
        ))}
      </ul>
      <div className="space-y-2">
        <label htmlFor={`reply-${id}`} className="block text-xs font-medium text-neutral-600">
          Paste a reply
        </label>
        <Textarea id={`reply-${id}`} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} rows={4} />
        <p className="text-xs text-neutral-500">Replies are kept as data. Recording one pauses this contact&apos;s sequences and makes one triage task. A request to stop is added to the suppression list.</p>
        <Button onClick={() => void record()} disabled={busy}>
          Record reply
        </Button>
      </div>
    </div>
  );
}

/** The inbox (SPEC 10, 12): one conversation per contact, replies to read, mark and record. */
export function InboxView({ client = api, onEvents = socketEvents }: { client?: InboxClient; onEvents?: (cb: (m: LiveMessage) => void) => () => void }) {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setThreads(await client.threads());
      setError(null);
    } catch (err) {
      setError(`Cannot reach the server at ${API}. Is \`pnpm dev\` running? (${(err as Error).message})`);
    }
  }, [client]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const eventsRef = useRef(onEvents);
  eventsRef.current = onEvents;
  useEffect(() => eventsRef.current((m) => void (m.kind === 'task.changed' && refreshRef.current())), []);

  return (
    <section aria-labelledby="inbox-title" className="space-y-4">
      <h1 id="inbox-title" className="text-xl font-semibold">
        Inbox
      </h1>
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {threads === null && !error && <p className="text-sm text-neutral-500">Loading…</p>}
      {threads && threads.length === 0 && <p className="text-sm text-neutral-600">No conversations yet. They start when an email is sent or a reply is recorded.</p>}
      {threads && threads.length > 0 && (
        <ul aria-label="conversations" className="space-y-2">
          {threads.map((t) => (
            <li key={t.id} className="rounded-md border border-neutral-200">
              <button type="button" className="flex w-full flex-col gap-1 p-3 text-left" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{t.lead_name ?? t.lead_email ?? 'Unknown'}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${t.last_direction === 'in' ? 'bg-blue-100 text-blue-800' : 'bg-neutral-100 text-neutral-700'}`}>{t.last_direction === 'in' ? 'Replied' : 'Sent'}</span>
                </span>
                <span className="line-clamp-2 break-words text-sm text-neutral-600">{t.last_body}</span>
              </button>
              {open === t.id && (
                <div className="border-t border-neutral-200 p-3">
                  <Conversation client={client} id={t.id} onChanged={() => void refresh()} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
