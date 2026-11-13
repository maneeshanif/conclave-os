import Link from 'next/link';
import { GoalsView } from '../../components/GoalsView';

export const metadata = { title: 'Goals · Conclave OS' };

/** The goal ladder and each department's goal (SPEC 3, 12). */
export default function GoalsPage() {
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <nav className="mb-6 flex gap-4 text-sm">
        <Link href="/" className="text-neutral-500 hover:text-neutral-900">
          ← Tasks
        </Link>
        <Link href="/approvals" className="text-neutral-500 hover:text-neutral-900">
          Approvals
        </Link>
        <Link href="/action-items" className="text-neutral-500 hover:text-neutral-900">
          Needs you
        </Link>
      </nav>
      <GoalsView />
    </main>
  );
}
