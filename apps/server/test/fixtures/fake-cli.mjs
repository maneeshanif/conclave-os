// A stand-in for `claude` and `opencode` in tests. Usage: node fake-cli.mjs <claude|opencode> <mode> [cli args...]
// Modes: ok, fail, limit, auth, env, turns, hang, token.
import { readFileSync } from 'node:fs';

const [flavor, mode, ...args] = process.argv.slice(2);
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
let stdin = '';
try {
  stdin = readFileSync(0, 'utf8');
} catch {
  stdin = '';
}

const envReport = () => JSON.stringify({ keys: Object.keys(process.env).sort(), args, stdin });

if (flavor === 'claude') {
  const sid = '11111111-1111-4111-8111-111111111111';
  out({ type: 'system', subtype: 'init', session_id: sid, tools: [] });
  if (mode === 'fail') {
    process.stderr.write('boom: something broke\n');
    process.exit(3);
  }
  if (mode === 'hang') setInterval(() => undefined, 1000);
  else {
    const turns = mode === 'turns' ? 50 : 1;
    for (let i = 0; i < turns; i++) {
      out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t${i}`, name: 'mcp__os__get_task', input: {} }] } });
      out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: 'task text', is_error: false }] } });
    }
    const text = mode === 'env' ? envReport() : mode === 'token' ? `token is ${process.env.CONCLAVE_RUN_TOKEN}` : 'All done.';
    out({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
    if (mode === 'limit') {
      out({ type: 'result', subtype: 'success', is_error: true, result: 'Claude AI usage limit reached|1794500000', session_id: sid, total_cost_usd: 0, usage: {} });
    } else if (mode === 'auth') {
      out({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login', session_id: sid, usage: {} });
    } else {
      out({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: sid, total_cost_usd: 0.0123, usage: { input_tokens: 100, output_tokens: 20 } });
    }
  }
} else {
  const sid = 'ses_fake123';
  const ev = (type, part) => out({ type, timestamp: Date.now(), sessionID: sid, part: { sessionID: sid, ...part } });
  if (mode === 'fail') {
    process.stderr.write('boom: something broke\n');
    process.exit(3);
  }
  if (mode === 'hang') setInterval(() => undefined, 1000);
  else {
    const turns = mode === 'turns' ? 50 : 1;
    for (let i = 0; i < turns; i++) {
      ev('step_start', { type: 'step-start' });
      ev('tool_use', { type: 'tool', tool: 'os_get_task', callID: `c${i}`, state: { status: 'completed', input: {}, output: 'task text' } });
      ev('step_finish', { type: 'step-finish', reason: 'tool-calls', tokens: { input: 50, output: 10 }, cost: 0 });
    }
    if (mode === 'limit') {
      out({ type: 'error', timestamp: Date.now(), sessionID: sid, error: { name: 'APIError', data: { message: 'Rate limit exceeded: too many requests (429)' } } });
      process.exit(1);
    }
    if (mode === 'auth') {
      out({ type: 'error', timestamp: Date.now(), sessionID: sid, error: { name: 'ProviderAuthError', data: { message: 'No provider credentials: unauthorized' } } });
      process.exit(1);
    }
    ev('step_start', { type: 'step-start' });
    const text = mode === 'env' ? envReport() : mode === 'token' ? `token is ${process.env.CONCLAVE_RUN_TOKEN}` : 'All done.';
    ev('text', { type: 'text', text });
    ev('step_finish', { type: 'step-finish', reason: 'stop', tokens: { input: 50, output: 10 }, cost: 0 });
  }
}
