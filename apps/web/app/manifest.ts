import type { MetadataRoute } from 'next';

/** The installable app (S1-11). It opens on the office (S6-12c): the office is the whole app, and a notification still opens the approvals panel. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Conclave OS',
    short_name: 'Conclave',
    description: 'Your company of AI agents. Approve, reject and answer from anywhere.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#171717',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
