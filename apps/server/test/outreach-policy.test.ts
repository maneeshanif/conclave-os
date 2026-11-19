import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkClaims, emailFooter, isSuppressed } from '../src/actions/policy';
import { OutboxTransport, ResendTransport, transportFromEnv, type OutgoingEmail } from '../src/actions/transport';

const COMPANY = 'Our first build is $2,500. A retainer is USD 400 a month.';

describe('claims that may never go out (CLAUDE.md rule 7)', () => {
  it('lets a plain, specific note through', () => {
    expect(checkClaims('Hi Dana, I saw your booking page asks for a phone call first. Happy to share a concept.', COMPANY)).toEqual({ ok: true, reasons: [] });
  });

  it.each([
    ['cure', 'Our laser will cure your acne.'],
    ['treatment', 'We offer treatment for hair loss.'],
    ['FDA-approved', 'This is FDA-approved and safe.'],
    ['clinically proven', 'A clinically proven method.'],
    ['guaranteed results', 'We promise guaranteed results.'],
    ['no side effects', 'There are no side effects.'],
    ['a named drug with a safety claim', 'Semaglutide is safe for everyone.'],
    ['a dosage', 'The right dose is easy to find.'],
  ])('blocks a medical claim: %s', (_name, text) => {
    const r = checkClaims(text, COMPANY);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/medical claim/);
  });

  it.each([
    ['legal advice', 'This is legal advice for your clinic.'],
    ['HIPAA-compliant', 'Our chatbot is HIPAA-compliant.'],
    ['a guarantee you will not be sued', 'We guarantee you will not be sued.'],
  ])('blocks a legal claim: %s', (_name, text) => {
    const r = checkClaims(text, COMPANY);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/legal claim/);
  });

  it('blocks a price that is not written in COMPANY.md, and lets through one that is', () => {
    expect(checkClaims('It costs $499.', COMPANY).reasons.join(' ')).toMatch(/price not in COMPANY\.md: "\$499"/);
    expect(checkClaims('The first build is $2,500.', COMPANY).ok).toBe(true);
  });

  it('matches a price however it is written: commas, spaces, USD, the k suffix', () => {
    expect(checkClaims('That is $2500.', COMPANY).ok).toBe(true);
    expect(checkClaims('That is USD 2,500.', COMPANY).ok).toBe(true);
    expect(checkClaims('A retainer is $400.', COMPANY).ok).toBe(true);
    expect(checkClaims('That is 2500 dollars.', COMPANY).ok).toBe(false); // spelled differently from the file, so refused
    expect(checkClaims('A $3k project.', COMPANY).ok).toBe(false);
  });

  it('refuses every price when COMPANY.md has none', () => {
    expect(checkClaims('Only $10.', '').ok).toBe(false);
  });

  it('reports every problem, not just the first', () => {
    const r = checkClaims('A cure for $9 that is HIPAA-compliant.', COMPANY);
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe('the cold email footer', () => {
  async function company(md: string) {
    const dir = await mkdtemp(path.join(tmpdir(), 'conclave-footer-'));
    await writeFile(path.join(dir, 'COMPANY.md'), md);
    return dir;
  }

  it('reads the section and accepts a real postal address', async () => {
    const f = await emailFooter(await company('# Co\n\n## Cold email footer\nConclave AI, 12 Main Street, Lahore 54000, Pakistan\n\n## People\nx\n'));
    expect(f).toEqual({ text: 'Conclave AI, 12 Main Street, Lahore 54000, Pakistan', placeholder: false });
  });

  it.each([
    ['a TODO', '## Cold email footer\nTODO fill in\n'],
    ['an [address] placeholder', '## Cold email footer\nConclave AI, [address]\n'],
    ['a [business address] placeholder', '## Cold email footer\nConclave AI, [Business Address]\n'],
    ['an empty section', '## Cold email footer\n\n## People\nx\n'],
    ['no section at all', '# Co\n\n## People\nx\n'],
  ])('treats %s as a placeholder, so nothing can be sent', async (_name, md) => {
    expect((await emailFooter(await company(md))).placeholder).toBe(true);
  });

  it('keeps the whole footer when the address runs over several lines', async () => {
    const f = await emailFooter(await company('# Co\n\n## Cold email footer\nConclave AI\n12 Main Street\nLahore 54000, Pakistan\n\n## People\nx\n'));
    expect(f).toEqual({ text: 'Conclave AI\n12 Main Street\nLahore 54000, Pakistan', placeholder: false });
  });

  it('does not run past the next heading of any level, and never mistakes that heading for the footer', async () => {
    expect((await emailFooter(await company('## Cold email footer\nAddr 1\n### Notes\nsecret\n'))).text).toBe('Addr 1');
    expect((await emailFooter(await company('## Cold email footer\n# Next\nx\n'))).placeholder).toBe(true);
  });

  it('finds the footer in a file saved with Windows line endings', async () => {
    const f = await emailFooter(await company('# Co\r\n\r\n## Cold email footer\r\nConclave AI\r\n12 Main Street, Lahore\r\n\r\n## People\r\nx\r\n'));
    expect(f.placeholder).toBe(false);
    expect(f.text).toContain('12 Main Street, Lahore');
  });

  it('finds the heading however it is capitalised or spaced', async () => {
    expect((await emailFooter(await company('##   cold EMAIL footer  \nAddr 1\n'))).text).toBe('Addr 1');
  });

  it('treats a missing COMPANY.md as a placeholder', async () => {
    expect((await emailFooter(await mkdtemp(path.join(tmpdir(), 'conclave-empty-')))).placeholder).toBe(true);
  });
});

describe('the suppression list', () => {
  it('matches an exact address, ignoring case and spaces', () => {
    expect(isSuppressed('  Owner@Clinic.com ', ['owner@clinic.com'])).toBe(true);
  });

  it('matches however the list entry was typed: capitals and spaces in the stored value change nothing', () => {
    expect(isSuppressed('owner@clinic.com', ['OWNER@CLINIC.COM'])).toBe(true);
    expect(isSuppressed('owner@clinic.com', ['  owner@clinic.com  '])).toBe(true);
    expect(isSuppressed('anyone@clinic.com', ['@CLINIC.com'])).toBe(true);
  });

  it('matches a whole domain written as @domain', () => {
    expect(isSuppressed('anyone@clinic.com', ['@clinic.com'])).toBe(true);
    expect(isSuppressed('ANYONE@CLINIC.COM', ['@clinic.com'])).toBe(true);
  });

  it('does not match a different address or a longer domain', () => {
    expect(isSuppressed('other@clinic.com', ['owner@clinic.com'])).toBe(false);
    expect(isSuppressed('a@notclinic.com', ['@clinic.com'])).toBe(false);
    expect(isSuppressed('a@clinic.com.au', ['@clinic.com'])).toBe(false);
    expect(isSuppressed('a@mail.clinic.com', ['@clinic.com'])).toBe(false);
  });

  it('suppresses nothing when the list is empty', () => {
    expect(isSuppressed('a@b.co', [])).toBe(false);
  });
});

const email = (over: Partial<OutgoingEmail> = {}): OutgoingEmail => ({
  id: 'appr-1',
  from: 'Anees <hello@example.test>',
  to: 'owner@clinic.test',
  subject: 'A homepage concept',
  text: 'Hi Dana',
  headers: { 'X-Conclave-Approval': 'appr-1' },
  ...over,
});

describe('the outbox transport: nothing leaves the machine', () => {
  it('writes one file per approval, with the headers and the body', async () => {
    const dir = path.join(await mkdtemp(path.join(tmpdir(), 'conclave-outbox-')), 'outbox');
    const t = new OutboxTransport(dir);
    const { ref } = await t.send(email());
    expect(await readdir(dir)).toEqual(['appr-1.eml']);
    expect(ref).toBe(`outbox:${path.join(dir, 'appr-1.eml')}`);
    const text = await readFile(path.join(dir, 'appr-1.eml'), 'utf8');
    expect(text).toContain('From: Anees <hello@example.test>');
    expect(text).toContain('To: owner@clinic.test');
    expect(text).toContain('Subject: A homepage concept');
    expect(text).toContain('X-Conclave-Approval: appr-1');
    expect(text).toContain('Hi Dana');
  });

  it('keeps two approvals in two files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'conclave-outbox-'));
    const t = new OutboxTransport(dir);
    await t.send(email({ id: 'a' }));
    await t.send(email({ id: 'b' }));
    expect((await readdir(dir)).sort()).toEqual(['a.eml', 'b.eml']);
  });
});

describe('the Resend transport, with a fake network (no real request is ever made)', () => {
  it('posts the email with the approval id as the idempotency key and returns the provider id', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ id: 're_123' }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await new ResendTransport('key_test', fake).send(email());
    expect(out).toEqual({ ref: 'resend:re_123' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://api.resend.com/emails');
    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBe('appr-1');
    expect(headers.authorization).toBe('Bearer key_test');
    expect(JSON.parse(seen[0]!.init.body as string)).toMatchObject({ to: ['owner@clinic.test'], subject: 'A homepage concept' });
  });

  it('throws, with the status and message, when the provider refuses', async () => {
    const fake = (async () => new Response(JSON.stringify({ message: 'domain not verified' }), { status: 422 })) as unknown as typeof fetch;
    await expect(new ResendTransport('k', fake).send(email())).rejects.toThrow(/HTTP 422.*domain not verified/);
  });

  it('throws when the provider answers 200 without an id', async () => {
    const fake = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(new ResendTransport('k', fake).send(email())).rejects.toThrow(/refused/);
  });
});

describe('choosing the transport: real sending needs two settings, on purpose', () => {
  it('uses the outbox by default', () => {
    expect(transportFromEnv({}, '/data').name).toBe('outbox');
  });

  it('still uses the outbox when only an API key is set', () => {
    expect(transportFromEnv({ RESEND_API_KEY: 'key' }, '/data').name).toBe('outbox');
  });

  it('refuses to start Resend without a key', () => {
    expect(() => transportFromEnv({ OUTREACH_TRANSPORT: 'resend' }, '/data')).toThrow(/needs RESEND_API_KEY/);
  });

  it('uses Resend only when both are set', () => {
    expect(transportFromEnv({ OUTREACH_TRANSPORT: 'resend', RESEND_API_KEY: 'key' }, '/data').name).toBe('resend');
  });
});
