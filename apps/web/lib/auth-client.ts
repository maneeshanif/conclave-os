import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient } from 'better-auth/client';
import { API } from './api';

/** The browser's side of sign-in. Cookies travel with every call, because the web app and the server are different origins. */
const client = createAuthClient({
  baseURL: API,
  plugins: [passkeyClient()],
  fetchOptions: { credentials: 'include' },
});

function must<T extends { error?: { message?: string } | null }>(r: T): T {
  if (r.error) throw new Error(r.error.message || 'That did not work.');
  return r;
}

export const authClient = {
  async signInWithPasskey() {
    must(await client.signIn.passkey());
  },
  async addPasskey() {
    must(await client.passkey.addPasskey({ name: 'This device' }));
  },
  async enrol(code: string) {
    const res = await fetch(`${API}/api/auth/owner/enrol`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message ?? 'That code did not work.');
  },
  async signOut() {
    await client.signOut();
  },
};
