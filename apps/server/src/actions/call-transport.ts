import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** What a call transport is asked to place: the approved call, nothing else. */
export interface CallRequest {
  approvalId: string;
  to: string;
  opener: string;
  script: string;
}

export interface CallTransport {
  readonly name: string;
  place(req: CallRequest): Promise<{ ref: string }>;
}

/**
 * The only call transport built (S9-8): it writes the approved call to a file and dials nothing, the way the email outbox sends nothing. A real
 * one (Retell for the voice, Twilio for the line) is a connector a person switches on later; it is not here, and nothing calls without it.
 */
export function outboxCallTransport(dataDir: string): CallTransport {
  return {
    name: 'outbox',
    async place(req) {
      const dir = path.join(dataDir, 'calls');
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${req.approvalId}.json`);
      await writeFile(file, JSON.stringify({ to: req.to, opener: req.opener, script: req.script, note: 'Nothing was dialled. This is the call that was approved.' }, null, 2) + '\n', { flag: 'wx' });
      return { ref: `outbox:${req.approvalId}` };
    },
  };
}
