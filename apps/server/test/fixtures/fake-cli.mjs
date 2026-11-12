/* global process, setInterval, fetch */
// A stand-in for `claude` and `opencode` in tests. Usage: node fake-cli.mjs <claude|opencode> <mode> [cli args...]
// Modes: ok, fail, limit, auth, env, turns, hang, token, mcp, forbidden, propose, prospect (claude only).
import { readFileSync } from 'node:fs';

// Reads the rendered MCP config in the working folder and calls the os server the way a real
// harness would: URL from the config, token expanded from the environment.
async function callOs(tool, toolArgs) {
  let url, auth;
  // Like the real CLIs: Claude Code gets the file from --mcp-config, OpenCode from OPENCODE_CONFIG.
  const cliArgs = process.argv.slice(4);
  const mcpArg = cliArgs.indexOf('--mcp-config');
  if (mcpArg >= 0) {
    const c = JSON.parse(readFileSync(cliArgs[mcpArg + 1], 'utf8')).mcpServers.os;
    url = c.url;
    auth = c.headers.Authorization.replace('${CONCLAVE_RUN_TOKEN}', process.env.CONCLAVE_RUN_TOKEN ?? '');
  } else {
    const c = JSON.parse(readFileSync(process.env.OPENCODE_CONFIG, 'utf8')).mcp.os;
    url = c.url;
    auth = c.headers.Authorization.replace('{env:CONCLAVE_RUN_TOKEN}', process.env.CONCLAVE_RUN_TOKEN ?? '');
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: auth },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: toolArgs } }),
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
  else if (mode === 'prospect') {
    const call = async (i, tool, input) => {
      out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `s${i}`, name: `mcp__os__${tool}`, input }] } });
      const r = await callOs(tool, input);
      out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `s${i}`, content: r.text, is_error: !r.ok }] } });
      return r;
    };
    await call(0, 'get_task', {});
    const found = [['Alpha Clinic', 'alpha-clinic.test', 90], ['Beta Spa', 'beta-spa.test', 75], ['Gamma Salon', 'gamma-salon.test', 55]];
    let n = 1;
    for (const [name, domain, score] of found) {
      const added = await call(n++, 'add_lead', { businessName: name, website: `https://${domain}`, email: `owner@${domain}`, notes: 'Booking page asks visitors to phone first.', sourceUrl: `https://maps.example.test/${domain}` });
      const id = /Added lead ([0-9a-f-]{36})/.exec(added.text)?.[1];
      if (id) await call(n++, 'score_lead', { leadId: id, score, reason: `Owner-led ${name} with a slow booking page.` });
    }
    await call(n, 'complete_task', { output: 'Added and scored three leads.' });
    out({ type: 'result', subtype: 'success', is_error: false, result: 'finished', session_id: sid, total_cost_usd: 0, usage: {} });
  } else if (mode === 'propose') {
    // An outreach rep that reads its task, finds the lead id in it, proposes one email and finishes.
    const call = async (i, tool, input) => {
      out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `p${i}`, name: `mcp__os__${tool}`, input }] } });
      const r = await callOs(tool, input);
      out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `p${i}`, content: r.text, is_error: !r.ok }] } });
      return r;
    };
    const task = await call(0, 'get_task', {});
    const leadId = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(JSON.parse(task.text).body ?? '')?.[0];
    const body = JSON.parse(task.text).body ?? '';
    const named = /step (\d+) and campaignId ([0-9a-f-]{36})/.exec(body);
    await call(1, 'propose_email', {
      leadId,
      subject: 'A homepage concept for you',
      body: 'Hi, I looked at your booking page and it asks visitors to phone first. Happy to share a concept.',
      step: named ? Number(named[1]) : 1,
      ...(named ? { campaignId: named[2] } : {}),
    });
    await call(2, 'complete_task', { output: 'Proposed one email.' });
    out({ type: 'result', subtype: 'success', is_error: false, result: 'finished', session_id: sid, total_cost_usd: 0, usage: {} });
  }
  else if (mode === 'mcp' || mode === 'forbidden') {
    const steps = mode === 'mcp' ? [['get_task', {}], ['complete_task', { output: 'Five facts.' }]] : [['send_email', { to: 'x@y.z' }]];
    for (const [i, [tool, input]] of steps.entries()) {
      out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `m${i}`, name: `mcp__os__${tool}`, input }] } });
      const r = await callOs(tool, input);
      out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `m${i}`, content: r.text, is_error: !r.ok }] } });
    }
    out({ type: 'result', subtype: 'success', is_error: false, result: 'finished', session_id: sid, total_cost_usd: 0, usage: {} });
  } else {
    // 'split' is ONE model message (one message.id) that Claude Code streams as seven events: it is one turn.
    const turns = mode === 'turns' ? 50 : mode === 'split' ? 6 : 1;
    const messageId = mode === 'split' ? { id: 'msg_split' } : {};
    for (let i = 0; i < turns; i++) {
      out({ type: 'assistant', message: { ...messageId, content: [{ type: 'tool_use', id: `t${i}`, name: 'mcp__os__get_task', input: {} }] } });
      out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: 'task text', is_error: false }] } });
    }
    const text = mode === 'env' ? envReport() : mode === 'token' ? `token is ${process.env.CONCLAVE_RUN_TOKEN}` : 'All done.';
    out({ type: 'assistant', message: { ...messageId, content: [{ type: 'text', text }] } });
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
