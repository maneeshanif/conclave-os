'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { API, api, type ActionItem } from '../lib/api';
import { socketEvents, type LiveMessage } from '../lib/live';
import { Button } from './ui/button';
import { Input } from './ui/field';

export interface ActionItemsClient {
  actionItems(): Promise<ActionItem[]>;
  resolve(id: string, note?: string): Promise<{ id: string; status: string }>;
}

const LABEL: Record<string, string> = {
  question: 'question',
  executor_failed: 'send failed',
  send_unknown: 'send unknown',
  blocked_task: 'blocked task',
  kill_switch: 'kill switch',
};
// Anything that can change what is on this list.
const WATCHED = new Set(['action_item.changed', 'task.changed', 'settings.changed', 'approval.changed']);

function Row({ item, onResolve }: { item: ActionItem; onResolve: (id: string, note: string) => Promise<void> }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const noteId = useId();

  async function done() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await onResolve(item.id, note.trim());
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-neutral-200 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{item.title}</h2>
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700">{LABEL[item.kind] ?? item.kind}</span>
      </div>
      {item.body && <p className="whitespace-pre-wrap text-sm text-neutral-800">{item.body}</p>}
      {item.created_at && <p className="text-xs text-neutral-500">{new Date(item.created_at).toLocaleString()}</p>}
      {item.derived ? (
        <p className="text-xs text-neutral-500">This clears itself when the cause is gone.</p>
      ) : (
        <div className="space-y-2">
          <label htmlFor={noteId} className="block text-xs font-medium text-neutral-600">
            Note (optional)
          </label>
          <Input id={noteId} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} placeholder="What you did or decided" />
          <p className="text-xs text-neutral-500">Marking it done records it. It does not restart the task or send anything.</p>
          <Button onClick={() => void done()} disabled={busy}>
            Mark done
          </Button>
        </div>
      )}
    </div>
  );
}

/** What needs the founder (SPEC 11, 12): questions, failed sends, blocked tasks and the kill switch. */
export function ActionItems({ client = api, onEvents = socketEvents }: { client?: ActionItemsClient; onEvents?: (onMessage: (m: LiveMessage) => void) => () => void }) {
  const [items, setItems] = useState<ActionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await client.actionItems());
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
  useEffect(() => eventsRef.current((m) => void (WATCHED.has(m.kind) && refreshRef.current())), []);

  async function onResolve(id: string, note: string) {
    setNotice(null);
    try {
      await client.resolve(id, note || undefined);
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      await refresh();
    }
  }

  return (
    <section aria-labelledby="items-title" className="space-y-4">
      <h1 id="items-title" className="text-xl font-semibold">
        Needs you
      </h1>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {notice}
        </p>
      )}
      {items === null && !error && <p className="text-sm text-neutral-500">Loading…</p>}
      {items && items.length === 0 && <p className="text-sm text-neutral-600">Nothing needs you right now.</p>}
      {items && items.length > 0 && (
        <ul aria-label="action items" className="space-y-4">
          {items.map((i) => (
            <li key={i.id}>
              <Row item={i} onResolve={onResolve} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
