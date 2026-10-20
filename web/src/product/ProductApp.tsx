import { useState } from 'react';

import lockupOnDark from '../../../brand/lockup-horizontal-on-dark.svg';
import lockup from '../../../brand/lockup-horizontal.svg';

import { ChargeNames } from './charges/ChargeNames';
import { DdCheck } from './dd/DdCheck';
import { FreightCheck } from './freight/FreightCheck';

type Tool = 'freight' | 'dd' | 'charges';

const TOOLS: readonly { id: Tool; label: string; title: string }[] = [
  { id: 'freight', label: 'Freight invoice', title: 'Accessorial and detention check against the rate confirmation' },
  { id: 'dd', label: 'Ocean D&D invoice', title: 'Demurrage and detention invoice audit against 46 CFR Part 541 and the carrier tariff' },
  { id: 'charges', label: 'Charge names', title: 'Recognise charge names across carriers' },
];

const SITE = import.meta.env['VITE_SITE_URL'] ?? '/';

export function ProductApp() {
  const [tool, setTool] = useState<Tool>('freight');
  const current = TOOLS.find((t) => t.id === tool) ?? TOOLS[0];
  return (
    <div className="flex min-h-screen flex-col">
      <header className="wrap flex w-full flex-wrap items-center justify-between gap-3 border-b py-3">
        <a href={SITE} aria-label="scoup.ai home" className="inline-block leading-none">
          <picture>
            <source media="(prefers-color-scheme: dark)" srcSet={lockupOnDark} />
            <img src={lockup} alt="scoup.ai" width="150" height="28" />
          </picture>
        </a>
        <nav aria-label="Site" className="flex gap-1 text-sm max-sm:order-3 max-sm:w-full max-sm:overflow-x-auto sm:flex-wrap">
          <a href={`${SITE}how-it-works/`}>How it works</a>
          <a href={`${SITE}security/`}>Security and privacy</a>
          <a href={`${SITE}pricing/`}>Pricing</a>
          <a href={`${SITE}contact/`}>Contact</a>
        </nav>
      </header>
      <div className="band w-full">
        <div className="wrap py-10">
          <h1 className="text-3xl font-bold sm:text-4xl">Check a freight invoice</h1>
          <p className="muted mt-2 max-w-2xl text-lg">Choose a tool, enter the figures from your documents, and get the arithmetic, the findings and a draft letter for review.</p>
          <p className="muted mt-3 text-sm" role="note">
            Runs entirely in your browser. Nothing you enter is uploaded, stored or sent to anyone.
          </p>
        </div>
      </div>
      <main className="wrap w-full flex-1 py-6">
        <div role="tablist" aria-label="Tools" className="tabs flex flex-wrap gap-1">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={t.id === tool} aria-controls={`panel-${t.id}`} className="tab" onClick={() => setTool(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tool}`} aria-labelledby={`tab-${tool}`} className="card mt-5">
          <h2 className="mt-0 text-base font-semibold">{current?.title}</h2>
          <div className="mt-3">
            {tool === 'freight' ? <FreightCheck /> : null}
            {tool === 'dd' ? <DdCheck /> : null}
            {tool === 'charges' ? <ChargeNames /> : null}
          </div>
        </div>
      </main>
      <footer className="wrap muted w-full border-t py-6 text-sm">
        <p className="m-0">
          scoup.ai checks invoices with fixed, published rules and shows its arithmetic. It does not decide what is owed and does not give legal advice.
          Outputs are drafts for a person to review. <a href={`${SITE}terms/`}>Terms</a> | <a href={`${SITE}privacy/`}>Privacy</a> | <a href={`${SITE}cookies/`}>Cookies</a>
        </p>
      </footer>
    </div>
  );
}