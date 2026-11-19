/** The lesson an edit teaches (S8-2). Pure: what the agent wrote, what the founder changed it to, said as a note the next run can match by words. */
const FIELDS: Record<string, { label: string; keys: readonly string[] }> = {
  'email.send': { label: 'an email', keys: ['subject', 'body'] },
  'post.publish': { label: 'a post', keys: ['text'] },
  'dm.send': { label: 'a direct message', keys: ['text'] },
};

const clip = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** A note for each field the founder actually changed, or null if nothing changed (an approval as it was teaches nothing). */
export function lessonFromEdit(kind: string, original: Record<string, unknown>, edited: Record<string, unknown>): string | null {
  const spec = FIELDS[kind];
  if (!spec) return null;
  const parts: string[] = [];
  for (const k of spec.keys) {
    const before = typeof original[k] === 'string' ? (original[k] as string) : '';
    const after = typeof edited[k] === 'string' ? (edited[k] as string) : '';
    if (after && after !== before) parts.push(`${k}: it was "${clip(before)}" and the founder made it "${clip(after)}"`);
  }
  return parts.length ? `The founder edited ${spec.label} before approving it. ${parts.join('; ')}. Write the next one the way the founder's version reads.` : null;
}
