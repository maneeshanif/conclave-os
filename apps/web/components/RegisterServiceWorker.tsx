'use client';

import { useEffect } from 'react';

/** Registers the shell worker in a production build only, so development never serves stale pages. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);
  return null;
}
