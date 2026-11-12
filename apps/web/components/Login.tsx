'use client';

import { useId, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/field';

export interface LoginClient {
  signInWithPasskey(): Promise<void>;
  enrol(code: string): Promise<void>;
  addPasskey(): Promise<void>;
}

/** Sign in with a passkey, or use the one-time setup code to get in and save a passkey (S1-10). */
export function Login({ client, onSignedIn }: { client: LoginClient; onSignedIn: () => void }) {
  const [code, setCode] = useState('');
  const [enrolled, setEnrolled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeId = useId();

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-md space-y-6 p-4 sm:p-6">
      <h1 className="text-xl font-semibold">Conclave OS</h1>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {!enrolled ? (
        <>
          <div className="space-y-2">
            <Button disabled={busy} onClick={() => void run(async () => { await client.signInWithPasskey(); onSignedIn(); })}>
              Sign in with a passkey
            </Button>
          </div>
          <form
            className="space-y-2 rounded-md border border-neutral-200 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              const value = code.trim();
              if (!value) return;
              void run(async () => {
                await client.enrol(value);
                setEnrolled(true);
              });
            }}
          >
            <h2 className="text-sm font-semibold">First time, or a new device</h2>
            <p className="text-xs text-neutral-500">
              The first setup code is in the file <code>owner-setup-code.txt</code> in the server&apos;s data folder. For another device, make a code from a device that is already signed in.
            </p>
            <label htmlFor={codeId} className="block text-xs font-medium text-neutral-600">
              Setup code
            </label>
            <Input id={codeId} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" disabled={busy} />
            <Button type="submit" variant="outline" disabled={busy}>
              Use code
            </Button>
          </form>
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">You are signed in. Save a passkey on this device so you can sign in without a code next time.</p>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void run(async () => { await client.addPasskey(); onSignedIn(); })}>
              Save a passkey on this device
            </Button>
            <Button variant="outline" disabled={busy} onClick={onSignedIn}>
              Not now
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
