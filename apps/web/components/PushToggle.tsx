'use client';

import { useCallback, useEffect, useState } from 'react';
import { browserPush, type PushClient, type PushState } from '../lib/push';
import { Button } from './ui/button';

const WORDS: Record<PushState, string> = {
  unsupported: 'This browser cannot get notifications. On an iPhone, add Conclave OS to the home screen first, then open it from there.',
  blocked: 'Notifications are blocked for this site. Allow them in the browser settings, then come back here.',
  off: 'Get a notification on this device for three things only: your morning brief, an approval waiting, and something that failed to go out. Nothing else, and never the text of a post or a lead.',
  on: 'Notifications are on for this device: the morning brief, an approval waiting, and a failure.',
};

/** Turns push notifications on or off for this device (SPEC 12). */
export function PushToggle({ client = browserPush }: { client?: PushClient }) {
  const [state, setState] = useState<PushState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await client.state());
    } catch (err) {
      setError((err as Error).message);
    }
  }, [client]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      await load();
    }
  }

  return (
    <section aria-labelledby="push-title" className="space-y-2 rounded-md border border-neutral-200 p-3">
      <h2 id="push-title" className="text-sm font-semibold text-neutral-700">
        Notifications on this device
      </h2>
      {state && <p className="text-sm text-neutral-800">{WORDS[state]}</p>}
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {state === 'off' && (
        <Button variant="outline" disabled={busy} onClick={() => void act(() => client.enable())}>
          Turn on notifications
        </Button>
      )}
      {state === 'on' && (
        <Button variant="outline" disabled={busy} onClick={() => void act(() => client.disable())}>
          Turn off notifications
        </Button>
      )}
    </section>
  );
}
