import { Suspense } from 'react';
import { OfficeScreen } from '../../components/OfficeScreen';

export const metadata = { title: 'Office · Conclave OS' };

/** The office (SPEC 12): the world, the plain list under it, and the panels over it. */
export default function OfficePage() {
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <Suspense fallback={null}>
        <OfficeScreen base="/office" />
      </Suspense>
    </main>
  );
}
