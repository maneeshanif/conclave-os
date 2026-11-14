// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LEGACY_ROUTES } from '../lib/panels';

const redirected: string[] = [];
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    redirected.push(to);
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  useRouter: () => ({ push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('../components/OfficeScreen', () => ({ OfficeScreen: ({ base }: { base?: string }) => <p>the office at {base ?? '/'}</p> }));

const pages = import.meta.glob('../app/*/page.tsx');
const app = path.resolve(import.meta.dirname, '..', 'app');
const components = path.resolve(import.meta.dirname, '..', 'components');
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));
const sources = [...walk(app), ...walk(components)].filter((f) => /\.tsx?$/.test(f));

afterEach(() => {
  cleanup();
  redirected.length = 0;
});

describe('the office is home (S6-12c)', () => {
  it('shows the office on the home page, and nothing else', async () => {
    const { default: Home } = await import('../app/page');
    render(<Home />);
    expect(screen.getByText('the office at /')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('sends each old route to the office with that panel open, and nothing else', async () => {
    for (const [route, id] of Object.entries(LEGACY_ROUTES)) {
      const load = pages[`../app${route}/page.tsx`];
      expect(load, route).toBeDefined();
      const mod = (await load!()) as { default: () => unknown };
      expect(() => mod.default(), route).toThrow(/NEXT_REDIRECT/);
      expect(redirected.at(-1), route).toBe(`/?panel=${id}`);
    }
    expect(redirected).toHaveLength(Object.keys(LEGACY_ROUTES).length);
  });

  it('sends the old office route to the home page', async () => {
    const mod = await import('../app/office/page');
    expect(() => mod.default()).toThrow(/NEXT_REDIRECT/);
    expect(redirected.at(-1)).toBe('/');
  });

  it('has no top link bar or link to another page anywhere: not a nav element, not next/link, no href to a route', () => {
    for (const f of sources) {
      const text = readFileSync(f, 'utf8');
      const where = path.relative(path.resolve(app, '..'), f);
      expect(text, `${where} imports next/link`).not.toMatch(/from 'next\/link'/);
      expect(text, `${where} has a nav element`).not.toMatch(/<nav[\s>]/);
      // A link may go outside (https), to a panel (/?panel=), or to a file in public; never to a page of the old kind.
      for (const m of text.matchAll(/href=["']([^"']+)["']/g)) {
        expect(m[1], `${where} links to ${m[1]}`).toMatch(/^(https?:|\/\?panel=|\/icons\/|\/manifest)/);
      }
    }
  });

  it('opens the panel, not a page, from the Brief\'s link to the signals', () => {
    const brief = readFileSync(path.join(components, 'BriefView.tsx'), 'utf8');
    expect(brief).toMatch(/href="\/\?panel=signals"/);
  });
});
