import { serve } from '@hono/node-server';
import { app } from './app';
import { HOST, resolvePort } from './config';

const port = resolvePort();

serve({ fetch: app.fetch, port, hostname: HOST }, (info) => {
  console.log(`conclave server listening on http://${HOST}:${info.port}`);
});
