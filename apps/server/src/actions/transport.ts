import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface OutgoingEmail {
  /** The approval id. Also the idempotency key, so a provider drops an accidental second request. */
  id: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  headers: Record<string, string>;
}

export interface EmailTransport {
  name: string;
  send(m: OutgoingEmail): Promise<{ ref: string }>;
}

/**
 * The default: writes each email to DATA_DIR/outbox instead of sending it. Nothing leaves the
 * machine until you set RESEND_API_KEY and OUTREACH_TRANSPORT=resend.
 */
export class OutboxTransport implements EmailTransport {
  readonly name = 'outbox';
  constructor(private readonly dir: string) {}
  async send(m: OutgoingEmail) {
    await mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `${m.id}.eml`);
    const headers = Object.entries(m.headers).map(([k, v]) => `${k}: ${v}`);
    await writeFile(file, [`From: ${m.from}`, `To: ${m.to}`, `Subject: ${m.subject}`, ...headers, '', m.text, ''].join('\r\n'), 'utf8');
    return { ref: `outbox:${file}` };
  }
}

/**
 * Resend's HTTP API. Written from Resend's public docs and not yet run against a real key here:
 * check https://resend.com/docs/api-reference/emails/send-email before the first real send.
 */
export class ResendTransport implements EmailTransport {
  readonly name = 'resend';
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async send(m: OutgoingEmail) {
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', 'idempotency-key': m.id },
      body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, text: m.text, headers: m.headers }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !body.id) throw new Error(`Resend refused the email (HTTP ${res.status}): ${body.message ?? 'no message'}`);
    return { ref: `resend:${body.id}` };
  }
}

/** Picks the transport from the environment. Real sending needs both settings, on purpose. */
export function transportFromEnv(env: Record<string, string | undefined>, dataDir: string): EmailTransport {
  if (env.OUTREACH_TRANSPORT === 'resend') {
    if (!env.RESEND_API_KEY) throw new Error('OUTREACH_TRANSPORT=resend needs RESEND_API_KEY.');
    return new ResendTransport(env.RESEND_API_KEY);
  }
  return new OutboxTransport(path.join(dataDir, 'outbox'));
}
