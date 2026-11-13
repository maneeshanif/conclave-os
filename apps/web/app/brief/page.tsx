import Link from 'next/link';
import { BriefView } from '../../components/BriefView';

export const metadata = { title: 'Morning brief · Conclave OS' };

/** The latest morning brief (SPEC 3, 12). */
export default function BriefPage() {
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <nav className="mb-6 flex gap-4 text-sm">
        <Link href="/" className="text-neutral-500 hover:text-neutral-900">
          ← Tasks
        </Link>
        <Link href="/approvals" className="text-neutral-500 hover:text-neutral-900">
          Approvals
        </Link>
        <Link href="/goals" className="text-neutral-500 hover:text-neutral-900">
          Goals
        </Link>
      </nav>
      <BriefView />
    </main>
  );
}
