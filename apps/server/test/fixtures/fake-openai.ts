import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for an OpenAI-compatible model endpoint (Ollama, say), so the in-process runtime is tested without a model.
 * The first path segment picks the behaviour: http://127.0.0.1:PORT/<mode>/v1. It answers Chat Completions, streaming or not.
 * Modes: ok, mcp, forbidden, env, limit, auth, hang, turns, skill:<name> (asks for that skill, then repeats what it got), and scout (a whole scout run).
 */
export interface FakeOpenAI {
  url(mode: string): string;
  /** Every request body received, as text. */
  seen: { mode: string; headers: IncomingMessage['headers']; body: string }[];
  close(): Promise<void>;
}

export async function startFakeOpenAI(secrets: Record<string, string> = {}): Promise<FakeOpenAI> {
  const seen: FakeOpenAI['seen'] = [];
  let n = 0;
  const sockets = new Set<ServerResponse>();

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const [, rawMode = 'ok', , tail] = (req.url ?? '').split('/');
      const mode = decodeURIComponent(rawMode);
      const body = Buffer.concat(chunks).toString('utf8');
      if (req.method === 'GET' && tail === 'models') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ object: 'list', data: [{ id: 'fake-model', object: 'model' }] }));
        return;
      }
      seen.push({ mode, headers: req.headers, body });
      const parsed = body ? (JSON.parse(body) as { stream?: boolean; messages?: { role: string; content?: unknown }[] }) : {};
      const toolResults = (parsed.messages ?? []).filter((m) => m.role === 'tool').length;
      const fail = (status: number, message: string) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message, type: 'error', code: String(status) } }));

      if (mode === 'limit') return fail(429, 'Rate limit reached');
      if (mode === 'auth') return fail(401, 'Incorrect API key provided');
      if (mode === 'hang') {
        sockets.add(res);
        res.on('close', () => sockets.delete(res));
        return; // never answers
      }

      let reply: { content?: string; tool?: { name: string; args: unknown } };
      if (mode === 'mcp') reply = toolResults === 0 ? { tool: { name: 'get_task', args: {} } } : toolResults === 1 ? { tool: { name: 'complete_task', args: { output: 'Five facts.' } } } : { content: 'All done.' };
      else if (mode === 'forbidden') reply = toolResults === 0 ? { tool: { name: 'send_email', args: { to: 'x@y.z' } } } : { content: 'gave up' };
      else if (mode.startsWith('skill:')) {
        // skill:<name> asks for that skill, then repeats back what it was given.
        const last = [...(parsed.messages ?? [])].reverse().find((m) => m.role === 'tool');
        reply = toolResults === 0 ? { tool: { name: 'load_skill', args: { name: mode.slice(6) } } } : { content: `GOT: ${typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content)}` };
      } else if (mode === 'scout') {
        // A scout's whole job, in tool calls: read the task, record two signals, score each from the id the tool gave back, finish.
        // Two markers in the task text switch it to the other behaviours the slice 4 end to end needs.
        const toolTexts = (parsed.messages ?? []).filter((m) => m.role === 'tool').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)));
        const idIn = (t: string | undefined) => /signal ([0-9a-f-]{36})/.exec(t ?? '')?.[1] ?? '';
        if (body.includes('BAD-DRAFT')) reply = { content: 'I looked at everything and I am done.' };
        else if (body.includes('TRIAGE-TASK')) reply = { content: 'Triaged: the reply is interested; book a call.' };
        else if (toolResults === 0) reply = { tool: { name: 'get_task', args: {} } };
        else if (toolResults === 1) reply = { tool: { name: 'add_signal', args: { kind: 'service_request', source: 'reddit', url: 'https://reddit.example/r/smallbiz/comments/e2e1', author: 'u/dana_clinic', excerpt: 'Looking for someone to rebuild our clinic booking page.' } } };
        else if (toolResults === 2) reply = { tool: { name: 'add_signal', args: { kind: 'pain_point', source: 'forum', url: 'https://forum.example/t/e2e2', author: 'shop_owner', excerpt: 'Our shop site is slow sometimes, whatever.' } } };
        else if (toolResults === 3) reply = { tool: { name: 'score_signal', args: { signalId: idIn(toolTexts[1]), score: 85, reason: 'Asks for exactly the service we sell.' } } };
        else if (toolResults === 4) reply = { tool: { name: 'score_signal', args: { signalId: idIn(toolTexts[2]), score: 30, reason: 'Vague and not a request.' } } };
        else if (toolResults === 5) reply = { tool: { name: 'complete_task', args: { output: 'Recorded 2 signals; 1 qualified.' } } };
        else reply = { content: 'Recorded 2 signals; 1 qualified.' };
      } else if (mode === 'turns') reply = { tool: { name: 'get_task', args: {} } };
      else if (mode === 'env') {
        const everything = `${body}\n${JSON.stringify(req.headers)}`;
        reply = { content: JSON.stringify({ keys: Object.entries(secrets).filter(([, v]) => everything.includes(v)).map(([k]) => k), args: [] }) };
      } else reply = { content: 'All done.' };

      const id = `chatcmpl-${++n}`;
      const base = { id, object: 'chat.completion.chunk', created: 1, model: 'fake-model' };
      const usage = { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 };
      const message = reply.tool
        ? { role: 'assistant', content: null, tool_calls: [{ id: `call_${n}`, type: 'function', function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.args) } }] }
        : { role: 'assistant', content: reply.content ?? '' };
      if (!parsed.stream) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id, object: 'chat.completion', created: 1, model: 'fake-model', choices: [{ index: 0, message, finish_reason: reply.tool ? 'tool_calls' : 'stop' }], usage }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      if (reply.tool) {
        send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call_${n}`, type: 'function', function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.args) } }] }, finish_reason: null }] });
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
      } else {
        send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: reply.content }, finish_reason: null }] });
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      }
      send({ ...base, choices: [], usage });
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: (mode) => `http://127.0.0.1:${port}/${mode}/v1`,
    seen,
    async close() {
      for (const r of sockets) r.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
