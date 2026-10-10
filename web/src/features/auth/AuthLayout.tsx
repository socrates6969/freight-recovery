import type { ReactNode } from 'react';

import { BrandLockup } from '../../components/ui/BrandLockup';

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center bg-[var(--color-surface)] px-4 pt-[12vh]">
      <BrandLockup height={32} className="mb-6" />
      <div className="card w-full max-w-sm p-6">
        <h1 className="mb-4 text-xl font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}
