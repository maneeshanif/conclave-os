import Link from 'next/link';
import { SignalsView } from '../../components/SignalsView';

export const metadata = { title: 'Signals · Conclave OS' };

/** What the scouts found, and what to do with it (SPEC 3, 12). */
export default function SignalsPage() {
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <nav className="mb-6 flex gap-4 text-sm">
        <Link href="/" className="text-neutral-500 hover:text-neutral-900">
          ← Tasks
        </Link>
        <Link href="/brief" className="text-neutral-500 hover:text-neutral-900">
          Brief
        </Link>
        <Link href="/inbox" className="text-neutral-500 hover:text-neutral-900">
          Inbox
        </Link>
      </nav>
      <SignalsView />
    </main>
  );
}
