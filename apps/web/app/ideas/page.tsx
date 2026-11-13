import Link from 'next/link';
import { IdeasView } from '../../components/IdeasView';

export const metadata = { title: 'Video ideas · Conclave OS' };

/** The Video Ideas inbox: drop an idea in from your phone (SPEC 8, 12). */
export default function IdeasPage() {
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <nav className="mb-6 flex gap-4 text-sm">
        <Link href="/" className="text-neutral-500 hover:text-neutral-900">
          ← Tasks
        </Link>
        <Link href="/approvals" className="text-neutral-500 hover:text-neutral-900">
          Approvals
        </Link>
        <Link href="/signals" className="text-neutral-500 hover:text-neutral-900">
          Signals
        </Link>
      </nav>
      <IdeasView />
    </main>
  );
}
