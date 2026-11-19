/**
 * What the Settings screen's Diagnostics shows (jsm-hq's Debug panel): which keys are set, never their values. A key is only ever reported
 * as set or not set, and a name is only on the list if the code reads it or a guide in docs/KEYS-GUIDE.md tells you to add it.
 */
export interface KeyStatus {
  name: string;
  set: boolean;
  /** What it is for. */
  for: string;
  /** Whether the code already has a real connector that uses it (see docs/KEYS-GUIDE.md). */
  usedByCode: boolean;
}

const KEYS: { name: string; for: string; usedByCode: boolean }[] = [
  { name: 'RESEND_API_KEY', for: 'Sending approved email', usedByCode: true },
  { name: 'OUTREACH_FROM', for: 'The address email is sent from', usedByCode: true },
  { name: 'CLAUDE_AGENT_API_KEY', for: 'The claude-agent runtime', usedByCode: true },
  { name: 'OPENAI_API_KEY', for: 'The hosted OpenAI model (alias openai)', usedByCode: true },
  { name: 'APIFY_TOKEN', for: 'Lead and signal sources', usedByCode: false },
  { name: 'APOLLO_API_KEY', for: 'Lead source', usedByCode: false },
  { name: 'LIVEKIT_API_KEY', for: 'Client meeting video', usedByCode: false },
  { name: 'VERCEL_TOKEN', for: 'Deploys', usedByCode: false },
  { name: 'SLACK_BOT_TOKEN', for: 'Slack sync', usedByCode: false },
  { name: 'JIRA_API_TOKEN', for: 'Jira tickets', usedByCode: false },
  { name: 'RETELL_API_KEY', for: 'Phone calls', usedByCode: false },
  { name: 'TWILIO_AUTH_TOKEN', for: 'Phone numbers', usedByCode: false },
];

/** Set means a value that is not empty or blank. The value itself is never returned. */
export function keyStatuses(env: Record<string, string | undefined>): KeyStatus[] {
  return KEYS.map((k) => ({ name: k.name, set: Boolean(env[k.name]?.trim()), for: k.for, usedByCode: k.usedByCode }));
}
