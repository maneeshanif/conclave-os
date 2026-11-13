import Link from 'next/link';
import { OfficeView } from '../../components/OfficeView';

export const metadata = { title: 'Office · Conclave OS' };

/** The office (SPEC 12). The plain version: rooms, agents and objects as a list. The world (S6-8b) sits above it. */
export default function OfficePage() {
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <nav className="mb-6 flex gap-4 text-sm">
        <Link href="/" className="text-neutral-500 hover:text-neutral-900">
          ← Tasks
        </Link>
        <Link href="/approvals" className="text-neutral-500 hover:text-neutral-900">
          Approvals
        </Link>
        <Link href="/health" className="text-neutral-500 hover:text-neutral-900">
          Health
        </Link>
      </nav>
      <h1 className="mb-4 text-xl font-semibold">Office</h1>
      <OfficeView />
    </main>
  );
}
