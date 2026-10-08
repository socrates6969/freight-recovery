import type { ReactNode } from 'react';

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-start justify-center bg-[var(--color-surface)] px-4 pt-[12vh]">
      <div className="card w-full max-w-sm p-6">
        <p className="muted mb-1 text-xs font-medium tracking-wide uppercase">Freight Recovery</p>
        <h1 className="mb-4 text-xl font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}
