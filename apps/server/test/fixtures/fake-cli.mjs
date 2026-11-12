/* global process, setInterval, fetch */
// A stand-in for `claude` and `opencode` in tests. Usage: node fake-cli.mjs <claude|opencode> <mode> [cli args...]
// Modes: ok, fail, limit, auth, env, turns, hang, token.
import { readFileSync } from 'node:fs';

// Reads the rendered MCP config in the working folder and calls the os server the way a real
// harness would: URL from the config, token expanded from the environment.
async function callOs(tool, args) {
  let url, auth;
  try {
    const c = JSON.parse(readFileSync('.mcp.json', 'utf8')).mcpServers.os;
    url = c.url;
    auth = c.headers.Authorization.replace('${CONCLAVE_RUN_TOKEN}', process.env.CONCLAVE_RUN_TOKEN ?? '');
  } catch {
    const c = JSON.parse(readFileSync('opencode.json', 'utf8')).mcp.os;
    url = c.url;
    auth = c.headers.Authorization.replace('{env:CONCLAVE_RUN_TOKEN}', process.env.CONCLAVE_RUN_TOKEN ?? '');
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: auth },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  });
  if (res.status !== 200) return { ok: false, text: `HTTP ${res.status}` };
  const j = await res.json();
  return { ok: !j.result?.isError, text: j.result?.content?.[0]?.text ?? JSON.stringify(j) };
}

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
  else if (mode === 'mcp' || mode === 'forbidden') {
    const steps = mode === 'mcp' ? [['get_task', {}], ['complete_task', { output: 'Five facts.' }]] : [['send_email', { to: 'x@y.z' }]];
    for (const [i, [tool, input]] of steps.entries()) {
      out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `m${i}`, name: `mcp__os__${tool}`, input }] } });
      const r = await callOs(tool, input);
      out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `m${i}`, content: r.text, is_error: !r.ok }] } });
    }
    out({ type: 'result', subtype: 'success', is_error: false, result: 'finished', session_id: sid, total_cost_usd: 0, usage: {} });
  } else {
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
  else if (mode === 'mcp' || mode === 'forbidden') {
    const steps = mode === 'mcp' ? [['get_task', {}], ['complete_task', { output: 'Five facts.' }]] : [['send_email', { to: 'x@y.z' }]];
    for (const [i, [tool, input]] of steps.entries()) {
      ev('step_start', { type: 'step-start' });
      const r = await callOs(tool, input);
      ev('tool_use', { type: 'tool', tool: `os_${tool}`, callID: `m${i}`, state: r.ok ? { status: 'completed', input, output: r.text } : { status: 'error', input, error: r.text } });
      ev('step_finish', { type: 'step-finish', reason: 'tool-calls', tokens: { input: 5, output: 1 }, cost: 0 });
    }
    ev('step_start', { type: 'step-start' });
    ev('text', { type: 'text', text: 'finished' });
    ev('step_finish', { type: 'step-finish', reason: 'stop', tokens: { input: 5, output: 1 }, cost: 0 });
  } else {
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
