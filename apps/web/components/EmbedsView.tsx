'use client';

import { useEffect, useState } from 'react';
import { API, api } from '../lib/api';

export interface EmbedsClient {
  tools(): Promise<{ name: string; url: string }[]>;
}

const real: EmbedsClient = { tools: api.embeddedTools };

/**
 * Outside web pages from the allow-list on Settings, one tab each, shown inside a sandbox. The page is not ours: it cannot reach this app's
 * cookies or storage (it is a different origin and the frame has no "same site" rights), and it cannot send you anywhere on its own
 * (no top navigation). Some sites refuse to be framed; for those there is a link that opens them in their own tab.
 */
export function EmbedsView({ client = real }: { client?: EmbedsClient }) {
  const [tools, setTools] = useState<{ name: string; url: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    let alive = true;
    client.tools().then(
      (t) => alive && setTools(t),
      (err: Error) => alive && setError(`Cannot reach the server at ${API}. Is \`pnpm dev\` running? (${err.message})`),
    );
    return () => {
      alive = false;
    };
  }, [client]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!tools) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!tools.length) return <p className="text-sm text-slate-500">No tools yet. Add a web address under Settings, Embedded tools.</p>;
  const tool = tools[Math.min(tab, tools.length - 1)]!;
  return (
    <div className="space-y-2 text-sm">
      <div role="tablist" aria-label="Embedded tools" className="flex flex-wrap gap-1">
        {tools.map((t, i) => (
          <button key={t.name} type="button" role="tab" aria-selected={t === tool} onClick={() => setTab(i)} className={`rounded border px-2 py-1 ${t === tool ? 'border-slate-700 bg-slate-100 font-medium' : 'border-slate-300'}`}>
            {t.name}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        If it stays blank the site does not allow being shown here:{' '}
        <a href={tool.url} target="_blank" rel="noopener noreferrer" className="underline">
          open it in its own tab
        </a>
        .
      </p>
      <iframe
        key={tool.url}
        title={tool.name}
        src={tool.url}
        sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
        referrerPolicy="no-referrer"
        allow=""
        className="h-[70vh] w-full rounded border border-slate-300 bg-white"
      />
    </div>
  );
}
