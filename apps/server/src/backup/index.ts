import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gunzipSync, gzipSync } from 'node:zlib';
import type pg from 'pg';
import { clockOf, dayOf } from '../brief/build';
import { withWorkspace } from '../db/tenant';

const run = promisify(execFile);

/**
 * The daily backup (SPEC 14, "Data loss"). A logical dump of every table, written in a format the OS itself can read back,
 * because the embedded Postgres ships without pg_dump. One gzip file of JSON lines with a checksum, written beside the
 * database and renamed into place only when complete, so a failed dump never leaves a half file and never touches the
 * old ones. The last 14 are kept. The company folder is committed to git when something changed. The OS never deletes a
 * database that holds data: restore only fills an empty one.
 */
export type WithOwner = <T>(fn: (client: pg.Client) => Promise<T>) => Promise<T>;

export interface BackupDeps {
  /** Owner access: it reads every tenant's rows, which the request role cannot. */
  withOwner: WithOwner;
  /** For the action item that says a backup failed. */
  pool: pg.Pool;
  workspaceId: string;
  dataDir: string;
  /** If set and inside a git repository, committed after a good dump. */
  companyRoot?: string;
  keep?: number;
  now?: () => Date;
  tz?: string | undefined;
}

const FORMAT = 'conclave-backup-1';
const SCHEMAS = ['public', 'auth'];
const q = (name: string) => name.split('.').map((p) => `"${p.replace(/"/g, '""')}"`).join('.');
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

interface Header {
  format: string;
  createdAt: string;
  tables: { name: string; rows: number; columns: string[] }[];
}
interface Backup {
  header: Header;
  data: Map<string, unknown[]>;
}

const backupDir = (dataDir: string) => join(dataDir, 'backups');

async function tableNames(c: pg.Client): Promise<string[]> {
  const r = await c.query<{ name: string }>("select n.nspname || '.' || c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and n.nspname = any($1) order by 1", [SCHEMAS]);
  return r.rows.map((x) => x.name);
}

/** Dumps every table to a new file in <dataDir>/backups and prunes the old ones. Throws, leaving the old backups alone, if anything fails. */
export async function writeBackup(deps: BackupDeps): Promise<{ file: string; rows: number; tables: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const dir = backupDir(deps.dataDir);
  mkdirSync(dir, { recursive: true });
  const name = `backup-${dayOf(now, deps.tz)}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.jsonl.gz`;
  const file = join(dir, name);
  const tmp = `${file}.tmp`;
  try {
    const data = await deps.withOwner(async (c) => {
      await c.query('begin isolation level repeatable read read only');
      try {
        const out = new Map<string, { columns: string[]; rows: unknown[] }>();
        for (const t of await tableNames(c)) {
          const cols = await c.query<{ column_name: string }>('select column_name from information_schema.columns where table_schema = $1 and table_name = $2 order by ordinal_position', t.split('.'));
          const rows = await c.query<{ r: unknown }>(`select to_jsonb(t) as r from ${q(t)} t`);
          out.set(t, { columns: cols.rows.map((x) => x.column_name), rows: rows.rows.map((x) => x.r) });
        }
        return out;
      } finally {
        await c.query('rollback');
      }
    });
    const header: Header = { format: FORMAT, createdAt: now.toISOString(), tables: [...data].map(([n, v]) => ({ name: n, rows: v.rows.length, columns: v.columns })) };
    let body = `${JSON.stringify(header)}\n`;
    for (const [n, v] of data) for (let i = 0; i < v.rows.length; i += 500) body += `${JSON.stringify({ t: n, rows: v.rows.slice(i, i + 500) })}\n`;
    const total = header.tables.reduce((a, t) => a + t.rows, 0);
    body += `${JSON.stringify({ end: true, rows: total, sha256: createHash('sha256').update(body).digest('hex') })}\n`;
    writeFileSync(tmp, gzipSync(body));
    await verifyBackup(tmp);
    renameSync(tmp, file);
    pruneBackups(dir, deps.keep ?? 14);
    return { file, rows: total, tables: header.tables.length };
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** Keeps the newest `keep` backups (their names sort by time) and removes the rest. */
export function pruneBackups(dir: string, keep: number): void {
  const all = readdirSync(dir).filter((f) => /^backup-.*\.jsonl\.gz$/.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - keep))) rmSync(join(dir, f), { force: true });
}

function readBackup(file: string): Backup {
  let text: string;
  try {
    text = gunzipSync(readFileSync(file)).toString('utf8');
  } catch {
    throw new Error(`${file} is not a complete backup file (it cannot be unpacked).`);
  }
  const lines = text.split('\n');
  if (lines.pop() !== '') throw new Error(`${file} is cut short.`);
  const last = lines.pop();
  const end = last ? (JSON.parse(last) as { end?: boolean; rows: number; sha256: string }) : null;
  if (!end?.end) throw new Error(`${file} is cut short: it has no end marker.`);
  const body = lines.map((l) => `${l}\n`).join('');
  if (createHash('sha256').update(body).digest('hex') !== end.sha256) throw new Error(`${file} has been changed since it was written (the checksum does not match).`);
  const header = JSON.parse(lines[0]!) as Header;
  if (header.format !== FORMAT) throw new Error(`${file} is not a ${FORMAT} backup.`);
  const data = new Map<string, unknown[]>(header.tables.map((t) => [t.name, []]));
  for (const l of lines.slice(1)) {
    const part = JSON.parse(l) as { t: string; rows: unknown[] };
    data.get(part.t)?.push(...part.rows);
  }
  for (const t of header.tables) if (data.get(t.name)!.length !== t.rows) throw new Error(`${file}: table ${t.name} should have ${t.rows} rows and has ${data.get(t.name)!.length}.`);
  return { header, data };
}

/** Checks a backup file end to end: it unpacks, the checksum matches, and every table has the rows it says. Returns what is in it. */
export async function verifyBackup(file: string): Promise<Header> {
  return readBackup(file).header;
}

/** Puts a backup into an empty database. Refuses, changing nothing, if the file is bad or the database holds data. */
export async function restoreBackup(withOwner: WithOwner, file: string): Promise<{ tables: number; rows: number }> {
  const { header, data } = readBackup(file); // checked first, before the database is touched
  return withOwner(async (c) => {
    await c.query('begin');
    try {
      const have = await tableNames(c);
      for (const t of header.tables) {
        if (!have.includes(t.name)) throw new Error(`The database has no table ${t.name}: run the migrations first.`);
        const cols = (await c.query<{ column_name: string }>('select column_name from information_schema.columns where table_schema = $1 and table_name = $2', t.name.split('.'))).rows.map((x) => x.column_name).sort();
        if (JSON.stringify(cols) !== JSON.stringify([...t.columns].sort())) throw new Error(`Table ${t.name} has different columns in this database than in the backup. Use the same version.`);
      }
      for (const t of have) {
        const n = (await c.query<{ n: number }>(`select count(*)::int as n from ${q(t)}`)).rows[0]!.n;
        if (n > (t === 'public.workspaces' ? 1 : 0)) throw new Error(`This database holds data (${t} has ${n} row${n === 1 ? '' : 's'}), so nothing was restored. A restore only fills an empty database.`);
      }
      await c.query('delete from public.workspaces'); // the one bootstrap row a new database starts with
      // Foreign keys form loops (a task points at a run, a run at its task), so tables load in dependency order, and where a
      // loop cannot be ordered, an optional link is left empty on the first pass and filled in on the second.
      const edges = (
        await c.query<{ child: string; parent: string; cols: string[]; notnull: boolean[] }>(
          "select cn.nspname || '.' || cc.relname as child, pn.nspname || '.' || pc.relname as parent, (select array_agg(a.attname::text order by x.ord) from unnest(k.conkey) with ordinality x(attnum, ord) join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.attnum) as cols, (select array_agg(a.attnotnull order by x.ord) from unnest(k.conkey) with ordinality x(attnum, ord) join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.attnum) as notnull from pg_constraint k join pg_class cc on cc.oid = k.conrelid join pg_namespace cn on cn.oid = cc.relnamespace join pg_class pc on pc.oid = k.confrelid join pg_namespace pn on pn.oid = pc.relnamespace where k.contype = 'f'",
        )
      ).rows.filter((e) => e.child !== e.parent && data.has(e.child) && data.has(e.parent));
      const broken = new Map<string, Set<string>>(); // table -> columns loaded empty first
      const live = new Set(edges);
      const todo = new Set(header.tables.map((t) => t.name));
      const order: string[] = [];
      while (todo.size) {
        const ready = [...todo].filter((t) => [...live].every((e) => e.child !== t || !todo.has(e.parent)));
        if (ready.length) {
          for (const t of ready) {
            order.push(t);
            todo.delete(t);
          }
          continue;
        }
        const cut = [...live].find((e) => todo.has(e.child) && todo.has(e.parent) && e.cols.some((col, i) => !e.notnull[i] && col !== 'workspace_id'));
        if (!cut) throw new Error(`Cannot order the tables to load: ${[...todo].join(', ')} depend on each other.`);
        live.delete(cut);
        const set = broken.get(cut.child) ?? new Set<string>();
        cut.cols.forEach((col, i) => {
          if (!cut.notnull[i] && col !== 'workspace_id') set.add(col);
        });
        broken.set(cut.child, set);
      }
      let rows = 0;
      for (const t of order) {
        const list = data.get(t)!;
        if (!list.length) continue;
        const empty = broken.get(t);
        const first = empty ? list.map((r) => ({ ...(r as object), ...Object.fromEntries([...empty].map((col) => [col, null])) })) : list;
        await c.query(`insert into ${q(t)} select * from json_populate_recordset(null::${q(t)}, $1::json)`, [JSON.stringify(first)]);
        rows += list.length;
      }
      for (const [t, cols] of broken) {
        const list = data.get(t)!;
        if (!list.length) continue;
        const pk = (await c.query<{ attname: string }>('select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = $1::regclass and i.indisprimary', [q(t)])).rows.map((r) => r.attname);
        const keep = [...pk, ...cols];
        const slim = list.map((r) => Object.fromEntries(keep.map((k) => [k, (r as Record<string, unknown>)[k]])));
        await c.query(`update ${q(t)} t set ${[...cols].map((k) => `${q(k)} = d.${q(k)}`).join(', ')} from json_populate_recordset(null::${q(t)}, $1::json) d where ${pk.map((k) => `t.${q(k)} = d.${q(k)}`).join(' and ')}`, [JSON.stringify(slim)]);
      }
      const serials = await c.query<{ s: string; t: string; col: string; seq: string }>("select table_schema as s, table_name as t, column_name as col, pg_get_serial_sequence(quote_ident(table_schema) || '.' || quote_ident(table_name), column_name) as seq from information_schema.columns where table_schema = any($1)", [SCHEMAS]);
      for (const x of serials.rows.filter((r) => r.seq)) await c.query(`select setval($1, coalesce((select max(${q(x.col)}) from ${q(`${x.s}.${x.t}`)}), 1), (select count(*) > 0 from ${q(`${x.s}.${x.t}`)}))`, [x.seq]);
      await c.query('commit');
      return { tables: header.tables.length, rows };
    } catch (err) {
      await c.query('rollback').catch(() => undefined);
      throw err;
    }
  });
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await run('git', args, { cwd })).stdout.trim();
}

/** Commits the company folder, and only it, when something in it changed. False if nothing changed or it is not in a git repository. */
export async function commitCompany(companyRoot: string, now = new Date()): Promise<boolean> {
  if (!existsSync(companyRoot)) return false;
  try {
    await git(companyRoot, ['rev-parse', '--show-toplevel']);
  } catch {
    return false;
  }
  if (!(await git(companyRoot, ['status', '--porcelain', '--', '.']))) return false;
  await git(companyRoot, ['add', '--', '.']);
  const who = (await git(companyRoot, ['config', 'user.email']).catch(() => '')) ? [] : ['-c', 'user.name=Conclave OS', '-c', 'user.email=conclave-os@localhost'];
  // The path form commits only these files, so anything else that is staged stays staged and uncommitted.
  await git(companyRoot, [...who, 'commit', '-q', '-m', `Company folder backup, ${dayOf(now)}`, '--', '.']);
  return true;
}

export type BackupResult = { ok: true; file: string; rows: number; committed: boolean } | { ok: false; error: string };

/** A backup, the company commit, and the item that says it failed: raised once however often it fails, closed by the next good one. */
export async function runBackup(deps: BackupDeps): Promise<BackupResult> {
  const now = (deps.now ?? (() => new Date()))();
  try {
    const r = await writeBackup(deps);
    let committed = false;
    if (deps.companyRoot && process.env.COMPANY_BACKUP_COMMIT !== '0') committed = await commitCompany(deps.companyRoot, now).catch((err: Error) => {
      console.error(`backup: the company folder could not be committed: ${err.message}`);
      return false;
    });
    await withWorkspace(deps.pool, deps.workspaceId, ({ client: c }) =>
      c.query("update action_items set status = 'done', resolved_at = now(), resolved_by = 'system', resolution_note = 'The next backup worked.' where kind = 'backup_failed' and status = 'open'"),
    ).catch(() => undefined);
    return { ok: true, file: r.file, rows: r.rows, committed };
  } catch (err) {
    const error = (err as Error).message;
    await withWorkspace(deps.pool, deps.workspaceId, async ({ client: c }) => {
      const body = `The daily backup failed: ${error}\nThe earlier backups are untouched. It is tried again within the hour.`;
      const open = await c.query("update action_items set body = $1 where kind = 'backup_failed' and status = 'open' returning id", [body]);
      if (!open.rows.length) await c.query("insert into action_items (workspace_id, kind, title, body) values ($1, 'backup_failed', 'The daily backup failed', $2)", [deps.workspaceId, body]);
    }).catch(() => undefined);
    return { ok: false, error };
  }
}

export interface DailyState {
  lastOkDay?: string;
  lastFailedAt?: Date;
}

/** Runs the backup once a day, after `after` (HH:MM). After a failure it waits an hour rather than trying every minute. */
export async function ensureDailyBackup(o: BackupDeps & { after?: string; state: DailyState }): Promise<BackupResult | null> {
  const now = (o.now ?? (() => new Date()))();
  if (clockOf(now, o.tz) < (o.after ?? '02:30')) return null;
  const day = dayOf(now, o.tz);
  if (o.state.lastOkDay === day) return null;
  const dir = backupDir(o.dataDir);
  if (existsSync(dir) && readdirSync(dir).some((f) => f.startsWith(`backup-${day}-`) && f.endsWith('.jsonl.gz'))) {
    o.state.lastOkDay = day; // made before a restart
    return null;
  }
  if (o.state.lastFailedAt && now.getTime() - o.state.lastFailedAt.getTime() < 3_600_000) return null;
  const r = await runBackup(o);
  if (r.ok) o.state.lastOkDay = day;
  else o.state.lastFailedAt = now;
  return r;
}
