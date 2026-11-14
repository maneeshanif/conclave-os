import { Suspense } from 'react';
import { OfficeScreen } from '../components/OfficeScreen';

/**
 * The home page is the office (SPEC 12): the world, the plain list under it, and every page of the app as a panel over it.
 * There is no link bar: you walk up to a thing and use it. The old routes lead here with a panel open (`/?panel=approvals`).
 */
export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <Suspense fallback={null}>
        <OfficeScreen base="/" />
      </Suspense>
    </main>
  );
}
