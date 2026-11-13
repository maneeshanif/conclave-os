'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { API, api, type Approval, type DecisionBody } from '../lib/api';
import { socketEvents, type LiveMessage } from '../lib/live';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input, Textarea } from './ui/field';

export interface InboxClient {
  approvals(status?: string): Promise<Approval[]>;
  decide(id: string, body: DecisionBody): Promise<{ id: string; status: string }>;
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** One email, ready to be read, edited and decided. The text may change; who it goes to may not. */
function EmailCard({ approval, onDecide }: { approval: Approval; onDecide: (id: string, body: DecisionBody) => Promise<void> }) {
  const p = approval.payload;
  const originalSubject = text(p.subject);
  const originalBody = text(p.body);
  const [subject, setSubject] = useState(originalSubject);
  const [message, setMessage] = useState(originalBody);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const ids = { subject: useId(), message: useId(), note: useId() };
  const step = Number(p.step ?? 1);

  async function decide(approved: boolean) {
    if (inFlight.current) return; // a second click while the first is still going does nothing
    inFlight.current = true;
    setBusy(true);
    const body: DecisionBody = { approved };
    if (approved && (subject !== originalSubject || message !== originalBody)) body.editedPayload = { subject, body: message };
    if (note.trim()) body.note = note.trim();
    try {
      await onDecide(approval.id, body);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-neutral-200 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{approval.lead?.business_name ?? text(p.to)}</h2>
          <p className="text-sm text-neutral-600">
            <span className="text-neutral-400">To </span>
            <span>{text(p.to)}</span>
          </p>
        </div>
        <p className="text-xs text-neutral-500">
          {step <= 1 ? 'First email' : `Follow-up ${step - 1}`} · proposed by {approval.agent_key ?? 'an agent'} · {new Date(approval.created_at).toLocaleString()}
        </p>
      </div>

      <div className="rounded bg-neutral-50 p-3 text-sm">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Why this email</p>
        {approval.lead?.website && <p className="mb-1 text-neutral-700">{approval.lead.website}</p>}
        <p className="whitespace-pre-wrap text-neutral-800">{approval.lead?.notes || 'No findings were recorded for this lead.'}</p>
      </div>

      <div className="space-y-2">
        <label htmlFor={ids.subject} className="block text-xs font-medium text-neutral-600">
          Subject
        </label>
        <Input id={ids.subject} value={subject} onChange={(e) => setSubject(e.target.value)} disabled={busy} />
        <label htmlFor={ids.message} className="block text-xs font-medium text-neutral-600">
          Message
        </label>
        <Textarea id={ids.message} value={message} onChange={(e) => setMessage(e.target.value)} disabled={busy} rows={9} />
        <p className="text-xs text-neutral-500">The company footer is added when it is sent. You can change the subject and the message, not who it goes to.</p>
        <label htmlFor={ids.note} className="block text-xs font-medium text-neutral-600">
          Note (optional)
        </label>
        <Input id={ids.note} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} placeholder="Why, if you want to say" />
      </div>

      <div className="flex gap-2">
        <Button onClick={() => void decide(true)} disabled={busy}>
          Approve
        </Button>
        <Button variant="outline" onClick={() => void decide(false)} disabled={busy}>
          Reject
        </Button>
      </div>
    </div>
  );
}

/** Any other kind of approval, shown plainly. It can be approved or rejected as it stands; only emails have an editable card. */
function PlainCard({ approval, onDecide }: { approval: Approval; onDecide: (id: string, body: DecisionBody) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  async function decide(approved: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await onDecide(approval.id, { approved });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 rounded-md border border-neutral-200 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{approval.kind}</h2>
        <p className="text-xs text-neutral-500">
          proposed by {approval.agent_key ?? 'an agent'} · {new Date(approval.created_at).toLocaleString()}
        </p>
      </div>
      <pre className="overflow-x-auto rounded bg-neutral-50 p-3 text-xs">{JSON.stringify(approval.payload, null, 2)}</pre>
      <div className="flex gap-2">
        <Button onClick={() => void decide(true)} disabled={busy}>
          Approve
        </Button>
        <Button variant="outline" onClick={() => void decide(false)} disabled={busy}>
          Reject
        </Button>
      </div>
    </div>
  );
}

/**
 * The approvals inbox (SPEC 6, 12): what is waiting for a decision. Nothing here sends anything; a decision goes to the
 * server, and the executor, plain code, acts on it. The list follows the server's live updates and a decided card leaves it.
 */
export function ApprovalsInbox({
  client = api,
  onEvents = socketEvents,
}: {
  client?: InboxClient;
  onEvents?: (onMessage: (m: LiveMessage) => void) => () => void;
}) {
  const [items, setItems] = useState<Approval[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await client.approvals('pending'));
      setError(null);
    } catch (err) {
      setError(`Cannot reach the server at ${API}. Is \`pnpm dev\` running? (${(err as Error).message})`);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Subscribe once. The listener always uses the latest refresh.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const eventsRef = useRef(onEvents);
  eventsRef.current = onEvents;
  useEffect(() => eventsRef.current((m) => void (m.kind === 'approval.changed' && refreshRef.current())), []);

  async function onDecide(id: string, body: DecisionBody) {
    setNotice(null);
    try {
      await client.decide(id, body);
    } catch (err) {
      // Said above the list, because the card may be about to disappear (someone else already decided it).
      setNotice((err as Error).message);
    } finally {
      await refresh();
    }
  }

  return (
    <section aria-labelledby="inbox-title" className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h1 id="inbox-title" className="text-xl font-semibold">
          Approvals
        </h1>
        {items && items.length > 0 && <Badge value="waiting_approval" />}
      </div>
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
      {items && items.length === 0 && <p className="text-sm text-neutral-600">Nothing is waiting for you.</p>}
      {items && items.length > 0 && (
        <ul aria-label="pending approvals" className="space-y-4">
          {items.map((a) => (
            <li key={a.id}>{a.kind === 'email.send' ? <EmailCard approval={a} onDecide={onDecide} /> : <PlainCard approval={a} onDecide={onDecide} />}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
