'use client';

import { useState } from 'react';
import { OfficeView, realOfficeClient } from './OfficeView';
import { OfficeWorld } from './OfficeWorld';

/** The world above the plain list. Walking up to an agent in the world opens its drawer in the list below. */
export function OfficeScreen() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <OfficeWorld client={realOfficeClient} onOpen={setOpen} />
      <OfficeView client={realOfficeClient} openId={open} />
    </div>
  );
}
