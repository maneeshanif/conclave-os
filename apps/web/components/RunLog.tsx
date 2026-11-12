import type { Run, StoredEvent } from '../lib/api';
import { Badge } from './ui/badge';

function line(e: StoredEvent['data']): { label: string; text: string; tone: string } {
  switch (e.type) {
    case 'session':
      return { label: 'session', text: e.sessionId, tone: 'text-neutral-500' };
    case 'thinking':
      return { label: 'thinking', text: e.text, tone: 'text-neutral-500 italic' };
    case 'message':
      return { label: 'says', text: e.text, tone: 'text-neutral-900' };
    case 'tool_call':
      return { label: 'calls', text: `${e.tool} ${JSON.stringify(e.input ?? {})}`, tone: 'text-blue-800' };
    case 'tool_result':
      return { label: e.ok ? 'result' : 'refused', text: `${e.tool}: ${e.summary}`, tone: e.ok ? 'text-neutral-700' : 'text-red-700' };
    case 'cost':
      return { label: 'cost', text: `$${e.usd.toFixed(4)} · ${e.tokensIn} in · ${e.tokensOut} out`, tone: 'text-neutral-500' };
    case 'done':
      return { label: 'done', text: e.output, tone: 'text-green-800' };
    case 'error':
      return { label: `error: ${e.kind}`, text: e.message, tone: 'text-red-700' };
  }
}

/** Every step of a run, in the order it happened (SPEC 14: each run keeps its full trace). */
export function RunLog({ run, events }: { run?: Pick<Run, 'status' | 'runtime' | 'cost_usd' | 'error'>; events: StoredEvent[] }) {
  const ordered = [...events].sort((a, b) => Number(a.id) - Number(b.id));
  return (
    <div className="rounded-md border border-neutral-200">
      {run && (
        <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 text-xs text-neutral-600">
          <Badge value={run.status} />
          <span>{run.runtime}</span>
          {run.cost_usd !== null && Number(run.cost_usd) > 0 && <span>est. ${Number(run.cost_usd).toFixed(4)}</span>}
          {run.error && <span className="text-red-700">{run.error}</span>}
        </div>
      )}
      <ol aria-label="run log" className="max-h-[28rem] overflow-auto font-mono text-xs">
        {ordered.length === 0 && <li className="px-3 py-2 text-neutral-500">No steps yet.</li>}
        {ordered.map((e) => {
          const l = line(e.data);
          return (
            <li key={e.id} className="flex gap-3 border-b border-neutral-100 px-3 py-1.5 last:border-0">
              <span className="w-20 shrink-0 text-neutral-500">{l.label}</span>
              <span className={`whitespace-pre-wrap break-words ${l.tone}`}>{l.text}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
