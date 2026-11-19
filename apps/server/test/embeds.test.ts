import { describe, expect, it } from 'vitest';
import { cleanEmbeds, embedProblem, MAX_EMBEDS } from '../src/embeds';

describe('the embedded tools allow-list rules', () => {
  it('accepts an ordinary public https address and writes it in its clean form', () => {
    expect(embedProblem({ name: 'Notion', url: 'https://www.notion.so/team' })).toBeNull();
    expect(cleanEmbeds([{ name: ' Trello ', url: ' https://trello.com/b/abc ' }])).toEqual([{ name: 'Trello', url: 'https://trello.com/b/abc' }]);
  });

  it('refuses anything that is not a public https page by name', () => {
    const bad = [
      'http://notion.so',
      'ftp://x.com',
      'javascript:alert(1)',
      'data:text/html,hi',
      'https://user:pw@notion.so',
      'https://notion.so:8443',
      'https://127.0.0.1',
      'https://10.0.0.5/x',
      'https://[::1]/x',
      'https://localhost',
      'https://app.localhost',
      'https://router.local',
      'https://printer.internal',
      'https://intranet',
      'not a url',
      '',
    ];
    for (const url of bad) expect(embedProblem({ name: 'x', url }), url).not.toBeNull();
    expect(embedProblem({ name: '', url: 'https://notion.so' })).toMatch(/name/);
    expect(embedProblem({ name: 'x'.repeat(41), url: 'https://notion.so' })).toMatch(/40/);
    expect(embedProblem({ name: 'x', url: `https://notion.so/${'a'.repeat(500)}` })).toMatch(/too long/);
  });

  it('limits the list, refuses a repeated name, and names the tool that is wrong', () => {
    expect(() => cleanEmbeds('nope')).toThrow(/list/);
    expect(() => cleanEmbeds(Array.from({ length: MAX_EMBEDS + 1 }, (_, i) => ({ name: `t${i}`, url: 'https://a.com' })))).toThrow(/At most/);
    expect(() => cleanEmbeds([{ name: 'A', url: 'https://a.com' }, { name: 'a', url: 'https://b.com' }])).toThrow(/two tools called/);
    expect(() => cleanEmbeds([{ name: 'Miro', url: 'http://miro.com' }])).toThrow(/^Miro: Only https/);
    expect(cleanEmbeds([])).toEqual([]);
  });
});
