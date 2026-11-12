/* global process, console */
// A tiny OpenAI-compatible chat endpoint for integration tests. It never calls a real model.
// Script: first turn calls <prefix>get_task, second calls <prefix>complete_task, then says "done".
import http from 'node:http';

const port = Number(process.argv[2] ?? 18080);
const prefix = process.argv[3] ?? 'os_';

const chunk = (delta, finish, usage) =>
  `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'fake', choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`;
const usage = { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 };

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url?.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: 'fake', object: 'model' }] }));
      }
      const j = JSON.parse(body || '{}');
      const isTitle = JSON.stringify(j.messages?.[0] ?? '').includes('title generator');
      const toolResults = (j.messages ?? []).filter((m) => m.role === 'tool').length;
      const tools = (j.tools ?? []).map((t) => t.function?.name);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const call = (name, args) => {
        res.write(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${toolResults}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, null));
        res.write(chunk({}, 'tool_calls', usage));
      };
      if (!isTitle && toolResults === 0 && tools.includes(`${prefix}get_task`)) call(`${prefix}get_task`, {});
      else if (!isTitle && toolResults === 1) call(`${prefix}complete_task`, { output: 'Fact 1 (COMPANY.md line 3)' });
      else {
        res.write(chunk({ role: 'assistant', content: isTitle ? 'Title' : `done; tools seen: ${tools.join(',')}` }, null));
        res.write(chunk({}, 'stop', usage));
      }
      res.end('data: [DONE]\n\n');
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`ready ${port}`));
