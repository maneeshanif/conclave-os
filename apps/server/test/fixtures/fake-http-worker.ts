import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A stand-in worker for the http runtime: the path is the mode, the way fake-openai does it. It speaks the worker protocol (NDJSON run events). */
export interface FakeWorker {
  url(mode: string): string;
  seen: { path: string; headers: Record<string, string | string[] | undefined>; body: string }[];
  close(): Promise<void>;
}

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let s = '';
    req.on('data', (c) => (s += String(c)));
    req.on('end', () => resolve(s));
  });

async function callOs(url: string, token: string, tool: string, args: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }) });
  if (res.status !== 200) return { ok: false, text: `HTTP ${res.status}` };
  const j = (await res.json()) as { result?: { isError?: boolean; content?: { text?: string }[] } };
  return { ok: !j.result?.isError, text: j.result?.content?.[0]?.text ?? '' };
}

export async function startFakeWorker(): Promise<FakeWorker> {
  const seen: FakeWorker['seen'] = [];
  const server: Server = createServer((req, res) => {
    void (async () => {
      const text = await read(req);
      const mode = (req.url ?? '/').slice(1);
      seen.push({ path: mode, headers: req.headers, body: text });
      const body = JSON.parse(text || '{}') as { sessionId?: string; os?: { url: string; token: string } };
      if (mode === 'limit') return void res.writeHead(429).end('slow down');
      if (mode === 'auth') return void res.writeHead(401).end('no');
      if (mode === 'json') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ output: `Plain answer, token ${body.os?.token ?? ''}` }));
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      const out = (o: unknown) => res.write(`${JSON.stringify(o)}\n`);
      out({ type: 'session', sessionId: body.sessionId ?? 'worker-1' });
      if (mode === 'hang') return void setTimeout(() => res.end(), 60_000);
      if (mode === 'mcp' || mode === 'forbidden') {
        const steps: [string, unknown][] = mode === 'mcp' ? [['get_task', {}], ['complete_task', { output: 'Five facts.' }]] : [['send_email', { to: 'x@y.z' }]];
        for (const [tool, input] of steps) {
          out({ type: 'tool_call', tool, input });
          const r = await callOs(body.os!.url, body.os!.token, tool, input);
          out({ type: 'tool_result', tool, ok: r.ok, summary: r.text.slice(0, 200) });
        }
      }
      if (mode === 'leak') out({ type: 'message', text: `my token is ${body.os?.token}` });
      if (mode === 'garbage') {
        res.write('not json\n{"type":"surprise"}\n');
      }
      const report = mode === 'env' ? JSON.stringify({ keys: Object.keys(body).sort(), args: body.sessionId ? [body.sessionId] : [] }) : 'All done.';
      if (mode !== 'cut') out({ type: 'done', output: report, sessionId: body.sessionId ?? 'worker-1' });
      res.end();
    })();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: (mode) => `http://127.0.0.1:${port}/${mode}`,
    seen,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections?.();
        server.close(() => r());
      }),
  };
}
