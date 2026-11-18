/**
 * The live terminal in an agent's drawer (S6C-6, jsm-hq's idea): the last steps of its latest run, one line each, like a terminal. Pure: it turns
 * stored run events into lines. The events were already stripped of the run token when they were stored; lines are cut short so a long tool
 * result cannot flood the drawer, and the text is shown as text.
 */
export interface StoredEvent {
  type: string;
  data: Record<string, unknown>;
}

export interface TerminalLine {
  kind: 'call' | 'result' | 'error' | 'say' | 'note';
  text: string;
}

const MAX_LINES = 40;
const MAX_LINE = 300;

const clip = (s: string) => (s.length > MAX_LINE ? `${s.slice(0, MAX_LINE - 1)}…` : s);
const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));

export function terminalLines(events: StoredEvent[]): TerminalLine[] {
  const out: TerminalLine[] = [];
  for (const e of events) {
    const d = e.data;
    switch (e.type) {
      case 'tool_call':
        out.push({ kind: 'call', text: clip(`$ ${str(d.tool)} ${str(d.input)}`.trim()) });
        break;
      case 'tool_result':
        out.push({ kind: 'result', text: clip(`${d.ok === true ? '✓' : '✗'} ${str(d.summary)}`.trim()) });
        break;
      case 'message':
      case 'thinking':
        if (str(d.text).trim()) out.push({ kind: 'say', text: clip(str(d.text).trim().replace(/\s+/g, ' ')) });
        break;
      case 'done':
        out.push({ kind: 'note', text: clip(`done: ${str(d.output)}`.replace(/\s+/g, ' ')) });
        break;
      case 'error':
        out.push({ kind: 'error', text: clip(`error (${str(d.kind)}): ${str(d.message)}`) });
        break;
      case 'retry':
      case 'repair':
      case 'reroute':
        out.push({ kind: 'note', text: clip(`${e.type}: ${str(d.reason ?? d.stage ?? d.to ?? '')}`.trim()) });
        break;
      default:
        break; // session, cost and the like are not steps a person watches
    }
  }
  return out.slice(-MAX_LINES);
}
