import type { MetadataRoute } from 'next';

/** The installable app (S1-11). It opens on the approvals page, the thing a phone is mostly for. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Conclave OS',
    short_name: 'Conclave',
    description: 'Your company of AI agents. Approve, reject and answer from anywhere.',
    start_url: '/approvals',
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
