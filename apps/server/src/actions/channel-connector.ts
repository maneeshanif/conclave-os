import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** What a channel connector is asked to send: exactly the approved reply. */
export interface ChannelReply {
  approvalId: string;
  channel: string;
  to: string;
  text: string;
}

export interface ChannelConnector {
  readonly name: string;
  send(reply: ChannelReply): Promise<{ ref: string }>;
}

/**
 * The only channel connector built (S10-6): it writes the approved reply to a file and posts nothing, the way the email outbox sends nothing.
 * Slack, Jira and a help desk are real connectors a person switches on later with their own sign-in; none is here.
 */
export function outboxChannelConnector(dataDir: string): ChannelConnector {
  return {
    name: 'outbox',
    async send(r) {
      const dir = path.join(dataDir, 'channels');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${r.approvalId}.json`), JSON.stringify({ channel: r.channel, to: r.to, text: r.text, note: 'Nothing was posted. This is the reply that was approved.' }, null, 2) + '\n', { flag: 'wx' });
      return { ref: `outbox:${r.approvalId}` };
    },
  };
}
