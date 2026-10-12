/**
 * Ocean D&D page (REQ-20261011-ocean-dd, Part B, C18; route /ocean). Shown only when the
 * `intelligence.ocean_dd` flag is on (fail closed) and the user has `claims:read`. Tabs: Invoices, Tariffs,
 * Calendars, Import CSV; controls inside each tab follow the C14 permissions.
 */
import { DD_NOTE, DD_TEXT } from '@fr/shared';
import { useState } from 'react';

import { useCan } from '../../app-context';
import { useFeatures } from '../intelligence/use-features';

import { CalendarsTab } from './CalendarsTab';
import { CsvImportTab } from './CsvImportTab';
import { InvoicesTab } from './InvoicesTab';
import { TariffsTab } from './TariffsTab';

const TABS = [
  { id: 'invoices', label: DD_TEXT.invoices },
  { id: 'tariffs', label: DD_TEXT.tariffs },
  { id: 'calendars', label: DD_TEXT.calendars },
  { id: 'csv', label: DD_TEXT.importCsv },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function OceanDdPage() {
  const features = useFeatures();
  const canRead = useCan('claims:read');
  const [tab, setTab] = useState<TabId>('invoices');
  if (!features.ready) return <div className="skeleton m-6 h-24" aria-hidden="true" />;
  if (!features.oceanDd || !canRead) {
    return (
      <main className="p-6">
        <p>Not found.</p>
      </main>
    );
  }
  return (
    <main className="p-6">
      <h1 className="mb-2 text-xl font-semibold">{DD_TEXT.nav}</h1>
      <p className="muted mb-4 text-sm">{DD_NOTE}</p>
      <div role="tablist" aria-label="Ocean D&D sections" className="mb-4 flex gap-1 border-b border-[var(--color-border)]">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`btn${tab === t.id ? ' btn-primary' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'invoices' ? <InvoicesTab /> : null}
        {tab === 'tariffs' ? <TariffsTab /> : null}
        {tab === 'calendars' ? <CalendarsTab /> : null}
        {tab === 'csv' ? <CsvImportTab /> : null}
      </div>
    </main>
  );
}
