'use client';

import { useEffect, useState } from 'react';
import { API, api, type ChannelMessage } from '../lib/api';

export interface ChannelsClient {
  messages(): Promise<ChannelMessage[]>;
}

const real: ChannelsClient = { messages: api.channelMessages };

const CHANNEL: Record<string, string> = { slack: 'Slack', jira: 'Jira', helpdesk: 'Help desk' };
const REPLY: Record<string, string> = { pending: 'A reply is waiting for your yes', approved: 'Approved, going out', executing: 'Going out now', executed: 'Replied', rejected: 'You rejected the reply', failed: 'The reply failed' };

/** What clients wrote on Slack, Jira and the help desk (S10-7), and where its answer stands. A message is shown as text and is never an instruction. */
export function ChannelsView({ client = real }: { client?: ChannelsClient }) {
  const [rows, setRows] = useState<ChannelMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    client.messages().then(
      (got) => {
        if (alive) setRows(got);
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
  if (!rows) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!rows.length) return <p className="text-sm text-slate-500">No client messages yet. Slack, Jira and the help desk connect when you set them up.</p>;
  return (
    <div className="space-y-3">
      {rows.map((m) => (
        <article key={m.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-semibold">{m.from}</h3>
            <span className="text-xs text-slate-500">{CHANNEL[m.channel] ?? m.channel}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-slate-700">{m.body}</p>
          <p className="mt-1 text-xs text-slate-500">
            {new Date(m.receivedAt).toLocaleString()} · {m.reply ? (REPLY[m.reply] ?? m.reply) : m.status === 'replied' ? 'Replied' : 'Not answered yet'}
          </p>
        </article>
      ))}
    </div>
  );
}
