import Link from 'next/link';
import { ActionItems } from '../../components/ActionItems';

export const metadata = { title: 'Needs you · Conclave OS' };

/** What needs the founder (SPEC 11, 12). */
export default function ActionItemsPage() {
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <nav className="mb-6 flex gap-4 text-sm">
        <Link href="/" className="text-neutral-500 hover:text-neutral-900">
          ← Tasks
        </Link>
        <Link href="/approvals" className="text-neutral-500 hover:text-neutral-900">
          Approvals
        </Link>
      </nav>
      <ActionItems />
    </main>
  );
}
