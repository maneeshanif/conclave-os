import { describe, expect, it } from 'vitest';
import { aliasWorksOn, modelNameFor, models, resolveModel, validateAliases, type ModelAlias } from '../src/config/models';
import { parseRoleFile } from '../src/company/loader';

const role = (runtime: string, model: string) => `---
id: scout
name: Scout
department: research
runtime: ${runtime}
model: ${model}
---

# Role
You scout.
`;

describe('model aliases (S4-1)', () => {
  it('ships local-worker on the in-process runtime and OpenCode, at a loopback endpoint', () => {
    expect(aliasWorksOn('local-worker', 'openai-agents')).toBe(true);
    expect(aliasWorksOn('local-worker', 'opencode')).toBe(true);
    expect(aliasWorksOn('local-worker', 'claude-cli')).toBe(false);
    expect(resolveModel('local-worker').baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(modelNameFor('local-worker', 'opencode')).toMatch(/^ollama\//);
  });

  it('the aliases we ship are all valid', () => {
    expect(validateAliases(models)).toEqual([]);
  });

  it('refuses an endpoint that is not on this machine unless the alias says so', () => {
    const remote: Record<string, ModelAlias> = { far: { name: 'm', on: ['openai-agents'], baseUrl: 'https://models.example.test/v1' } };
    expect(validateAliases(remote).join(' ')).toMatch(/far.*not on this machine/i);
    expect(validateAliases({ far: { ...remote.far!, allowRemote: true } })).toEqual([]);
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) expect(validateAliases({ ok: { name: 'm', on: ['openai-agents'], baseUrl: `http://${host}:11434/v1` } })).toEqual([]);
  });

  it('refuses a base URL that is not a URL, and one with a user name or password in it', () => {
    expect(validateAliases({ bad: { name: 'm', on: ['openai-agents'], baseUrl: 'not a url' } }).join(' ')).toMatch(/bad.*not a valid URL/i);
    expect(validateAliases({ bad: { name: 'm', on: ['openai-agents'], baseUrl: 'http://user:pw@127.0.0.1/v1' } }).join(' ')).toMatch(/bad.*credentials/i);
  });

  it('refuses an alias with no runtimes, and one that names a runtime that does not exist', () => {
    expect(validateAliases({ none: { name: 'm', on: [] } }).join(' ')).toMatch(/none.*no runtime/i);
    expect(validateAliases({ odd: { name: 'm', on: ['made-up' as never] } }).join(' ')).toMatch(/odd.*unknown runtime "made-up"/i);
  });

  it('a role file on the in-process runtime with local-worker loads; on claude-cli it is refused naming both', () => {
    expect(parseRoleFile(role('openai-agents', 'local-worker'), 'a/AGENT.md').role.runtime).toBe('openai-agents');
    expect(() => parseRoleFile(role('claude-cli', 'local-worker'), 'a/AGENT.md')).toThrow(/local-worker.*claude-cli/);
    expect(() => parseRoleFile(role('openai-agents', 'nope'), 'a/AGENT.md')).toThrow();
  });
});
