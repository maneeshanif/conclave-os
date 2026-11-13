import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PostPlatform } from '../posts';

/** What a transport is asked to publish: the exact approved text, on one account. */
export interface PostRequest {
  /** The approval id, also the idempotency key. */
  approvalId: string;
  platform: PostPlatform;
  handle: string;
  accountId: string;
  text: string;
}

export interface PostResult {
  ref: string;
  /** Where the post is (or, for the outbox, the file it was written to). */
  url: string;
  /** A screenshot of the result, as a key inside the data folder. */
  screenshot?: string;
}

export interface PostTransport {
  readonly name: 'outbox' | 'browser';
  publish(req: PostRequest): Promise<PostResult>;
}

/** The login is gone: the platform asked for one. Nothing was posted, so this is not a failed publish. */
export class SessionExpiredError extends Error {}

/**
 * The default: writes each post to DATA_DIR/outbox/posts instead of publishing it. Nothing leaves the machine. The browser
 * transport below is the real one, and stays off until a person has logged in by hand and turned it on for an account.
 */
export function outboxPostTransport(dataDir: string): PostTransport {
  return {
    name: 'outbox',
    async publish(req) {
      const dir = path.join(dataDir, 'outbox', 'posts');
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${req.approvalId}.json`);
      await writeFile(file, JSON.stringify({ platform: req.platform, handle: req.handle, text: req.text, writtenAt: new Date().toISOString() }, null, 2), 'utf8');
      return { ref: `outbox:${file}`, url: `outbox://posts/${req.approvalId}.json` };
    },
  };
}

/** A direct message to one person. The outbox writes it to a file; nothing is sent. */
export interface DmRequest {
  approvalId: string;
  channel: 'x_dm' | 'ig_dm';
  handle: string;
  recipient: string;
  text: string;
}
export interface DmTransport {
  readonly name: 'outbox';
  send(req: DmRequest): Promise<{ ref: string }>;
}
export function outboxDmTransport(dataDir: string): DmTransport {
  return {
    name: 'outbox',
    async send(req) {
      const dir = path.join(dataDir, 'outbox', 'dms');
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${req.approvalId}.json`);
      await writeFile(file, JSON.stringify({ channel: req.channel, handle: req.handle, recipient: req.recipient, text: req.text, writtenAt: new Date().toISOString() }, null, 2), 'utf8');
      return { ref: `outbox:${file}` };
    },
  };
}

/** Drives a signed-in browser on an account's profile. The Playwright implementation arrives with the profiles (S5-3). */
export interface BrowserDriver {
  /** Publishes the text, then returns the address the browser ended on and a screenshot of it. Throws SessionExpiredError if asked to log in. */
  publish(a: { platform: PostPlatform; handle: string; accountId: string; text: string }): Promise<{ finalUrl: string; screenshot: Buffer }>;
}

/** Publishes through a browser driver and keeps the screenshot in the data folder (SPEC 8: every executor run saves one). */
export function browserPostTransport(dataDir: string, driver: BrowserDriver): PostTransport {
  return {
    name: 'browser',
    async publish(req) {
      const out = await driver.publish({ platform: req.platform, handle: req.handle, accountId: req.accountId, text: req.text });
      const key = `screenshots/${req.approvalId}.png`;
      await mkdir(path.join(dataDir, 'screenshots'), { recursive: true });
      await writeFile(path.join(dataDir, key), out.screenshot);
      return { ref: `browser:${out.finalUrl}`, url: out.finalUrl, screenshot: key };
    },
  };
}
