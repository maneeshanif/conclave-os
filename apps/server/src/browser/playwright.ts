import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { profileDir, type LoginLauncher } from './profiles';
import type { DriverPage } from './driver';

/**
 * The real browser (Playwright) on an account's profile folder. It uses a browser already installed on the machine (Edge by
 * default on Windows, or CONCLAVE_BROWSER_CHANNEL / CONCLAVE_BROWSER_PATH), so nothing is downloaded. Not run by any automated
 * test: it needs a display, an installed browser and a person to log in.
 */
const options = (env: Record<string, string | undefined>) => ({
  ...(env.CONCLAVE_BROWSER_PATH ? { executablePath: env.CONCLAVE_BROWSER_PATH } : { channel: env.CONCLAVE_BROWSER_CHANNEL ?? 'msedge' }),
});

/** A visible browser for logging in by hand. The person closes the window when done. */
export function playwrightLoginLauncher(env: Record<string, string | undefined> = process.env): LoginLauncher {
  let ctx: BrowserContext | undefined;
  return {
    async open(dir, loginUrl) {
      ctx = await chromium.launchPersistentContext(dir, { headless: false, ...options(env) });
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto(loginUrl);
    },
    waitUntilClosed: () => new Promise<void>((resolve) => (ctx ? ctx.on('close', () => resolve()) : resolve())),
  };
}

/** A page on an account's profile, for the publishing driver. Visible when BROWSER_HEADLESS=0, which is how the first real post should be watched. */
export function playwrightPageOpener(dataDir: string, env: Record<string, string | undefined> = process.env): (accountId: string) => Promise<DriverPage> {
  return async (accountId) => {
    const ctx = await chromium.launchPersistentContext(profileDir(dataDir, accountId), { headless: env.BROWSER_HEADLESS !== '0', ...options(env) });
    const page: Page = ctx.pages()[0] ?? (await ctx.newPage());
    return {
      goto: async (u) => void (await page.goto(u, { waitUntil: 'domcontentloaded' })),
      url: () => page.url(),
      fill: async (sel, text) => {
        await page.locator(sel).first().click();
        await page.keyboard.insertText(text);
      },
      click: async (sel) => page.locator(sel).first().click(),
      waitForUrlChange: async (from) => {
        await page.waitForURL((u) => u.toString() !== from, { timeout: 15_000 }).catch(() => undefined);
        await page.waitForTimeout(1500);
      },
      screenshot: () => page.screenshot({ fullPage: false }),
      close: async () => void (await ctx.close()),
    };
  };
}
