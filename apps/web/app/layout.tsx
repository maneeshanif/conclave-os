import type { Viewport } from 'next';
import type { ReactNode } from 'react';
import { RegisterServiceWorker } from '../components/RegisterServiceWorker';
import './globals.css';

export const metadata = {
  title: 'Conclave OS',
  appleWebApp: { capable: true, title: 'Conclave', statusBarStyle: 'default' as const },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/icon-192.png' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#171717' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
