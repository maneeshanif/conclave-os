import Link from 'next/link';
import { PipelineView } from '../../components/PipelineView';

export const metadata = { title: 'Pipeline · Conclave OS' };

/** Deals by funnel stage (SPEC 10, 12). */
export default function PipelinePage() {
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <nav className="mb-6 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href="/" className="text-neutral-500 hover:text-neutral-900">
          ← Tasks
        </Link>
        <Link href="/approvals" className="text-neutral-500 hover:text-neutral-900">
          Approvals
        </Link>
        <Link href="/inbox" className="text-neutral-500 hover:text-neutral-900">
          Inbox
        </Link>
        <Link href="/campaigns" className="text-neutral-500 hover:text-neutral-900">
          Campaigns
        </Link>
        <Link href="/brief" className="text-neutral-500 hover:text-neutral-900">
          Brief
        </Link>
      </nav>
      <PipelineView />
    </main>
  );
}
