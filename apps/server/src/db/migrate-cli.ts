// `pnpm db:migrate`: start the embedded database, apply pending migrations, stop.
// The server runs the same migrations at every start, so this is for checking them on their own.
import { resolveDataDir, resolvePgPort } from '../config';
import { startDatabase } from './index';

const dataDir = resolveDataDir();
const db = await startDatabase({ dataDir, port: resolvePgPort() });
console.log(`migrations applied; database at ${dataDir}`);
await db.stop();
