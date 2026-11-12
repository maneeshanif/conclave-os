import Link from 'next/link';
import { ApprovalsInbox } from '../../components/ApprovalsInbox';

export const metadata = { title: 'Approvals · Conclave OS' };

/** What is waiting for the founder's yes (SPEC 6, 12). */
export default function ApprovalsPage() {
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <nav className="mb-6 text-sm">
        <Link href="/" className="text-neutral-500 hover:text-neutral-900">
          ← Tasks
        </Link>
      </nav>
      <ApprovalsInbox />
    </main>
  );
}
