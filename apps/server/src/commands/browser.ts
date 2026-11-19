import { loginAccount } from '../browser/profiles';
import { playwrightLoginLauncher } from '../browser/playwright';
import { openSystem } from '../system';

/** `pnpm run browser:login <account>`: a visible browser on the account's profile, for logging in by hand. The OS never sees the password. */
export async function browserLogin(ref: string | undefined): Promise<number> {
  if (!ref) {
    console.error('Usage: pnpm run browser:login <account handle or id>   (for example: pnpm run browser:login @acme_test)');
    return 2;
  }
  const sys = await openSystem();
  try {
    console.log('A browser window will open at the login page. Log in, then close the window. Nothing you type is seen by the OS.');
    const r = await loginAccount(sys.app, sys.workspace.id, sys.dataDir, ref, playwrightLoginLauncher());
    console.log(`Done: ${r.handle} has a browser profile and a valid login. To publish through it, switch the account on: POST /api/browser/accounts/${r.id}/transport {"transport":"browser"} (the Health screen shows the switch once the page for it exists).`);
    return 0;
  } finally {
    await sys.close();
  }
}
