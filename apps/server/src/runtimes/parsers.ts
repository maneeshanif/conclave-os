import type { ErrorKind, RunEvent } from './types';

const LIMIT = /usage limit|hit your limit|rate.?limit|limit reached|quota|too many requests|\b429\b|overloaded/i;
const AUTH = /not logged in|please run \/login|login required|invalid api key|authentication|unauthori[sz]ed|\b401\b|no provider|credentials/i;

/** Classifies a failure message. Plan limits and sign-in problems are their own kinds (SPEC 7). */
export function classifyError(text: string): ErrorKind {
  if (LIMIT.test(text)) return 'limit';
  if (AUTH.test(text)) return 'auth';
  return 'runtime';
}

function summarize(v: unknown, max = 200): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export interface Parser {
  /** Turns one stdout line into zero or more events. Non-JSON lines are ignored. */
  line(line: string): RunEvent[];
  /** Called after the process exits. Returns the final events if the stream did not end the run itself. */
  end(exitCode: number | null, stderr: string): RunEvent[];
  /** Model turns seen so far, for the max-turns guard. */
  turns(): number;
}

function parseJson(line: string): Json | null {
  const t = line.trim();
  if (!t.startsWith('{')) return null;
  try {
    return JSON.parse(t) as Json;
  } catch {
    return null;
  }
}

/** Claude Code `--output-format stream-json`. */
export function claudeParser(): Parser {
  const toolNames = new Map<string, string>();
  let sessionId: string | undefined;
  let finished = false;
  let turns = 0;
  return {
    turns: () => turns,
    line(line) {
      const e = parseJson(line);
      if (!e) return [];
      const out: RunEvent[] = [];
      const type = str(e.type);
      if (type === 'system' && str(e.subtype) === 'init' && str(e.session_id)) {
        sessionId = str(e.session_id);
        out.push({ type: 'session', sessionId });
      } else if (type === 'assistant') {
        turns++;
        for (const c of (obj(e.message).content as unknown[] | undefined) ?? []) {
          const b = obj(c);
          if (b.type === 'text' && str(b.text)) out.push({ type: 'message', text: str(b.text) });
          else if (b.type === 'thinking' && str(b.thinking)) out.push({ type: 'thinking', text: str(b.thinking) });
          else if (b.type === 'tool_use') {
            toolNames.set(str(b.id), str(b.name));
            out.push({ type: 'tool_call', tool: str(b.name), input: b.input });
          }
        }
      } else if (type === 'user') {
        for (const c of (obj(e.message).content as unknown[] | undefined) ?? []) {
          const b = obj(c);
          if (b.type === 'tool_result') {
            out.push({
              type: 'tool_result',
              tool: toolNames.get(str(b.tool_use_id)) ?? 'unknown',
              ok: b.is_error !== true,
              summary: summarize(b.content),
            });
          }
        }
      } else if (type === 'result') {
        finished = true;
        const usage = obj(e.usage);
        out.push({
          type: 'cost',
          usd: num(e.total_cost_usd),
          tokensIn: num(usage.input_tokens),
          tokensOut: num(usage.output_tokens),
        });
        const text = str(e.result);
        const sid = str(e.session_id) || sessionId;
        if (e.is_error === true || (str(e.subtype) && str(e.subtype) !== 'success')) {
          const kind: ErrorKind = str(e.subtype) === 'error_max_turns' ? 'max_turns' : classifyError(`${text} ${str(e.subtype)}`);
          out.push({ type: 'error', kind, message: text || str(e.subtype) || 'run failed' });
        } else {
          out.push({ type: 'done', output: text, ...(sid ? { sessionId: sid } : {}) });
        }
      }
      return out;
    },
    end(code, stderr) {
      if (finished) return [];
      const msg = stderr.trim() || `exit ${code}`;
      return [{ type: 'error', kind: code === 0 ? 'runtime' : classifyError(msg), message: msg.slice(0, 2000) }];
    },
  };
}

/** OpenCode `run --format json` (shapes checked against opencode 1.19.5 with a fake model). */
export function opencodeParser(): Parser {
  let sessionId: string | undefined;
  let turns = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let usd = 0;
  let lastText = '';
  let failed: RunEvent | undefined;
  return {
    turns: () => turns,
    line(line) {
      const e = parseJson(line);
      if (!e) return [];
      const out: RunEvent[] = [];
      if (!sessionId && str(e.sessionID)) {
        sessionId = str(e.sessionID);
        out.push({ type: 'session', sessionId });
      }
      const part = obj(e.part);
      switch (str(e.type)) {
        case 'step_start':
          turns++;
          lastText = '';
          break;
        case 'text':
          if (str(part.text)) {
            lastText += (lastText ? '\n' : '') + str(part.text);
            out.push({ type: 'message', text: str(part.text) });
          }
          break;
        case 'reasoning':
          if (str(part.text)) out.push({ type: 'thinking', text: str(part.text) });
          break;
        case 'tool_use': {
          const state = obj(part.state);
          const tool = str(part.tool);
          out.push({ type: 'tool_call', tool, input: state.input });
          const status = str(state.status);
          if (status === 'completed' || status === 'error') {
            out.push({
              type: 'tool_result',
              tool,
              ok: status === 'completed',
              summary: summarize(status === 'error' ? state.error : state.output),
            });
          }
          break;
        }
        case 'step_finish': {
          const t = obj(part.tokens);
          tokensIn += num(t.input);
          tokensOut += num(t.output);
          usd += num(part.cost);
          break;
        }
        case 'error': {
          const err = obj(e.error);
          const msg = str(obj(err.data).message) || str(err.message) || str(err.name) || JSON.stringify(e.error ?? e);
          failed = { type: 'error', kind: classifyError(msg), message: msg };
          break;
        }
      }
      return out;
    },
    end(code, stderr) {
      const cost: RunEvent = { type: 'cost', usd, tokensIn, tokensOut };
      if (failed) return [cost, failed];
      if (code !== 0) {
        const msg = stderr.trim() || `exit ${code}`;
        return [cost, { type: 'error', kind: classifyError(msg), message: msg.slice(0, 2000) }];
      }
      return [cost, { type: 'done', output: lastText, ...(sessionId ? { sessionId } : {}) }];
    },
  };
}
