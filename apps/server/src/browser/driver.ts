import { SessionExpiredError, type BrowserDriver } from '../actions/post-transport';
import type { PostPlatform } from '../posts';

/**
 * The browser driver for publishing (SPEC 8). It drives one page through a small interface so the flow can be tested without a
 * browser; `./playwright.ts` supplies a real page on a signed-in profile.
 *
 * UNVERIFIED: the recipes below (compose address, the boxes and buttons to use) are written from how the sites looked when this
 * was written and have NOT met a real logged-in account, because the OS cannot log in for you. Sites change their pages. The
 * first real post must be watched with the browser visible (`BROWSER_HEADLESS=0`) and the selectors fixed if they are off.
 * Where a site offers a posting API, an API transport is better than this.
 */
export interface DriverPage {
  goto(url: string): Promise<void>;
  url(): string;
  fill(selector: string, text: string): Promise<void>;
  click(selector: string): Promise<void>;
  /** Waits for the address to change after pressing Post, or for a short time to pass. */
  waitForUrlChange(from: string): Promise<void>;
  screenshot(): Promise<Buffer>;
  close(): Promise<void>;
}

interface Recipe {
  compose: string;
  /** An address that means "you are logged out". */
  loginMarkers: RegExp;
  box: string;
  post: string;
}

const RECIPES: Partial<Record<PostPlatform, Recipe>> = {
  x: { compose: 'https://x.com/compose/post', loginMarkers: /\/(i\/flow\/)?login|\/i\/flow\/login/i, box: '[data-testid="tweetTextarea_0"]', post: '[data-testid="tweetButton"]' },
  linkedin: { compose: 'https://www.linkedin.com/feed/', loginMarkers: /\/(login|uas\/login|checkpoint)/i, box: '.ql-editor[contenteditable="true"]', post: 'button.share-actions__primary-action' },
};

/** Builds the driver. `open` gives a fresh page on the account's profile; it is always closed afterwards. */
export function playwrightDriver(open: (accountId: string) => Promise<DriverPage>): BrowserDriver {
  return {
    async publish({ platform, accountId, text }) {
      const recipe = RECIPES[platform];
      if (!recipe) throw new Error(`${platform} posts need an image, which a text post cannot give, so the browser cannot publish this one. Use a post with media (video and image work arrive in a later task) or the outbox.`);
      const page = await open(accountId);
      try {
        await page.goto(recipe.compose);
        // A login page here means the session is gone. Nothing has been typed, so nothing is half-posted.
        if (recipe.loginMarkers.test(page.url())) throw new SessionExpiredError(`${platform} sent the browser to its login page`);
        await page.fill(recipe.box, text);
        const before = page.url();
        await page.click(recipe.post); // once. A failure after this point is never retried.
        await page.waitForUrlChange(before);
        const screenshot = await page.screenshot();
        return { finalUrl: page.url(), screenshot };
      } finally {
        await page.close().catch(() => undefined);
      }
    },
  };
}
