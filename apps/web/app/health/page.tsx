import Link from 'next/link';
import { HealthView } from '../../components/HealthView';

export const metadata = { title: 'Health · Conclave OS' };

/** What is running, what is failing, what is switched off, and the kill switch (SPEC 12, 14). */
export default function HealthPage() {
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <nav className="mb-6 flex gap-4 text-sm">
        <Link href="/" className="text-neutral-500 hover:text-neutral-900">
          ← Tasks
        </Link>
        <Link href="/approvals" className="text-neutral-500 hover:text-neutral-900">
          Approvals
        </Link>
        <Link href="/brief" className="text-neutral-500 hover:text-neutral-900">
          Brief
        </Link>
      </nav>
      <HealthView />
    </main>
  );
}
