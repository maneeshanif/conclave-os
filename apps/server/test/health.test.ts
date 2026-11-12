import { describe, expect, it } from 'vitest';
import { HealthSchema } from '@conclave/shared';
import { app } from '../src/app';
import { HOST, resolvePort } from '../src/config';

describe('server health', () => {
  it('GET /health answers 200 with { ok: true }', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(HealthSchema.parse(await res.json())).toEqual({ ok: true });
  });

  it('listens on 127.0.0.1 only', () => {
    expect(HOST).toBe('127.0.0.1');
  });

  it('reads PORT, defaults to 3100, rejects nonsense', () => {
    expect(resolvePort({})).toBe(3100);
    expect(resolvePort({ PORT: '3200' })).toBe(3200);
    expect(() => resolvePort({ PORT: 'abc' })).toThrow();
  });
});
