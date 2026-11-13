import Link from 'next/link';
import { InboxView } from '../../components/InboxView';

export const metadata = { title: 'Inbox · Conclave OS' };

/** Conversations with leads (SPEC 10, 12). */
export default function InboxPage() {
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <nav className="mb-6 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href="/" className="text-neutral-500 hover:text-neutral-900">
          ← Tasks
        </Link>
        <Link href="/approvals" className="text-neutral-500 hover:text-neutral-900">
          Approvals
        </Link>
        <Link href="/pipeline" className="text-neutral-500 hover:text-neutral-900">
          Pipeline
        </Link>
        <Link href="/campaigns" className="text-neutral-500 hover:text-neutral-900">
          Campaigns
        </Link>
        <Link href="/brief" className="text-neutral-500 hover:text-neutral-900">
          Brief
        </Link>
      </nav>
      <InboxView />
    </main>
  );
}
