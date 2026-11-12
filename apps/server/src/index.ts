import { serve } from '@hono/node-server';
import { createApp } from './app';
import { HOST, resolveDataDir, resolvePgPort, resolvePort } from './config';
import { startDatabase } from './db';

const port = resolvePort();
const db = await startDatabase({ dataDir: resolveDataDir(), port: resolvePgPort() });
const app = createApp({ pool: db.appPool, workspaceId: db.workspaceId });

const server = serve({ fetch: app.fetch, port, hostname: HOST }, (info) => {
  console.log(`conclave server listening on http://${HOST}:${info.port}`);
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close();
  await db.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
