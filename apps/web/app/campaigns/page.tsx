import Link from 'next/link';
import { CampaignsView } from '../../components/CampaignsView';

export const metadata = { title: 'Campaigns · Conclave OS' };

/** Campaigns and their results (SPEC 10, 12). */
export default function CampaignsPage() {
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
        <Link href="/pipeline" className="text-neutral-500 hover:text-neutral-900">
          Pipeline
        </Link>
        <Link href="/brief" className="text-neutral-500 hover:text-neutral-900">
          Brief
        </Link>
      </nav>
      <CampaignsView />
    </main>
  );
}
