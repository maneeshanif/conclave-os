import { withWorkspace } from '../db/tenant';
import { readSettings } from '../settings';
import type { CallTransport } from './call-transport';
import type { ExecResult, ExecutorDeps } from './email';

/**
 * The `call.place` executor (S9-8, SPEC 6, 15). Plain code, no model. After a person approves a call it claims once and hands exactly the
 * approved call to the call transport. With no transport it refuses and says so; the only one built writes a file and dials nothing. A call
 * is never retried, because a second call is a second person disturbed.
 */
interface Payload {
  leadId: string;
  phone: string;
  opener: string;
  script: string;
}

export async function executeCall(deps: ExecutorDeps, approvalId: string): Promise<ExecResult> {
  const ws = deps.workspaceId;
  const claim = await withWorkspace(deps.pool, ws, async ({ client: c }) => {
    if ((await readSettings(c, ws)).killSwitch) return { kind: 'kill_switch' as const };
    const r = await c.query<{ payload: Payload }>("update approvals set status = 'executing' where id = $1 and status = 'approved' and kind = 'call.place' returning payload", [approvalId]);
    return r.rows[0] ? { kind: 'claimed' as const, payload: r.rows[0].payload } : { kind: 'none' as const };
  });
  if (claim.kind === 'kill_switch') return { status: 'kill_switch' };
  if (claim.kind === 'none') return { status: 'already_claimed' };
  const p = claim.payload;
  const finish = async (ok: boolean, result: Record<string, unknown>) => {
    await withWorkspace(deps.pool, ws, async ({ client: c }) => {
      await c.query('update approvals set status = $2, result = $3 where id = $1', [approvalId, ok ? 'executed' : 'failed', JSON.stringify(result)]);
      if (ok) await c.query("update call_list_items set status = 'called' where lead_id = $1 and status = 'queued'", [p.leadId]);
      else await c.query("insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, 'executor_failed', 'A call was not placed', $2, $3) on conflict do nothing", [ws, `${String(result.reason)}\nIt was not retried.`, approvalId]);
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'executor:call', $2, $3, $4)", [ws, ok ? 'approval.executed' : 'approval.failed', approvalId, JSON.stringify(result)]);
    });
    deps.bus?.publish({ kind: 'approval.changed', workspaceId: ws, approvalId, status: ok ? 'executed' : 'failed' });
  };
  const transport: CallTransport | undefined = deps.callTransport;
  if (!transport) {
    const reason = 'there is no way to place calls set up on this server';
    await finish(false, { reason });
    return { status: 'refused', reason };
  }
  // The lead may have asked not to be called since the card was made: checked again now.
  const l = await withWorkspace(deps.pool, ws, async ({ client: c }) => (await c.query<{ stage: string }>('select stage from leads where id = $1', [p.leadId])).rows[0]);
  if (!l || l.stage === 'do_not_contact') {
    const reason = 'the lead is gone or has been marked do not contact';
    await finish(false, { reason });
    return { status: 'refused', reason };
  }
  try {
    const out = await transport.place({ approvalId, to: p.phone, opener: p.opener, script: p.script });
    await finish(true, { ref: out.ref, transport: transport.name });
    return { status: 'executed', ref: out.ref };
  } catch (err) {
    const reason = (err as Error).message;
    await finish(false, { reason, transport: transport.name });
    return { status: 'failed', reason };
  }
}

/** On start: an approved call that never went is placed once; one left `executing` may or may not have gone, so it is failed with a note and never placed again. */
export async function recoverCalls(deps: ExecutorDeps): Promise<{ resumed: string[]; unknown: string[] }> {
  const ws = deps.workspaceId;
  const { approved, executing } = await withWorkspace(deps.pool, ws, async ({ client: c }) => ({
    approved: (await c.query<{ id: string }>("select id from approvals where kind = 'call.place' and status = 'approved' order by decided_at, id")).rows.map((r) => r.id),
    executing: (await c.query<{ id: string }>("select id from approvals where kind = 'call.place' and status = 'executing'")).rows.map((r) => r.id),
  }));
  for (const id of executing) {
    await withWorkspace(deps.pool, ws, async ({ client: c }) => {
      await c.query("update approvals set status = 'failed', result = $2 where id = $1 and status = 'executing'", [id, JSON.stringify({ reason: 'interrupted; the outcome is unknown' })]);
      await c.query("insert into action_items (workspace_id, kind, title, body, approval_id) values ($1, 'send_unknown', 'A call may or may not have been placed', 'The server stopped while this call was being placed. It was not placed again. Check before approving a new copy.', $2) on conflict do nothing", [ws, id]);
    });
  }
  const resumed: string[] = [];
  for (const id of approved) if ((await executeCall(deps, id)).status === 'executed') resumed.push(id);
  return { resumed, unknown: executing };
}

export async function releaseCalls(deps: ExecutorDeps): Promise<string[]> {
  const ids = await withWorkspace(deps.pool, deps.workspaceId, ({ client: c }) => c.query<{ id: string }>("select id from approvals where kind = 'call.place' and status = 'approved' order by decided_at, id"));
  const out: string[] = [];
  for (const { id } of ids.rows) if ((await executeCall(deps, id)).status === 'executed') out.push(id);
  return out;
}
