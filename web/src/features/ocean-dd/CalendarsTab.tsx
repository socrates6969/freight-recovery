/**
 * Calendars tab (Part B): terminal calendars with closed dates (scheduled closures, not free time under a
 * working-day basis) and shutout dates (never free time, never charged), one date per line.
 */
import { DD_TEXT, DdCalendarData, DdCalendarView, type DdCalendarViewDto } from '@fr/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useApi, useCan, useToast } from '../../app-context';
import { SafeText } from '../../components/ui/SafeText';

import { AreaField, Section, TextField, ddErrorText, listOf, useDdCatalogs } from './dd-common';

function CalendarEditor({ existing, onDone, onCancel }: { existing: DdCalendarViewDto | null; onDone: () => void; onCancel: () => void }) {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(existing?.data.name ?? '');
  const [closed, setClosed] = useState(existing?.data.closedDates.join('\n') ?? '');
  const [shutout, setShutout] = useState(existing?.data.shutoutDates.join('\n') ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (data: unknown) =>
      existing === null ? api.post('/api/v1/dd/calendars', data, DdCalendarView) : api.put(`/api/v1/dd/calendars/${encodeURIComponent(existing.id)}`, { version: existing.version, data }, DdCalendarView),
    onSuccess: async () => {
      toast('Calendar saved.', 'success');
      await qc.invalidateQueries({ queryKey: ['dd', 'calendars'] });
      onDone();
    },
    onError: (e) => setError(ddErrorText(e)),
  });
  return (
    <form
      aria-label={existing ? 'Edit calendar' : DD_TEXT.newCalendar}
      onSubmit={(e) => {
        e.preventDefault();
        const r = DdCalendarData.safeParse({ name, closedDates: listOf(closed), shutoutDates: listOf(shutout) });
        if (!r.success) {
          setError(`Check these values: ${[...new Set(r.error.issues.map((i) => i.path.map(String).join('.') || 'calendar'))].join(', ')}`);
          return;
        }
        setError(null);
        save.mutate(r.data);
      }}
    >
      {error ? <p role="alert">{error}</p> : null}
      <Section title="Calendar">
        <TextField label="Name" value={name} onChange={setName} />
        <AreaField label="Closed dates (one per line)" value={closed} onChange={setClosed} />
        <AreaField label="Shutout dates (one per line)" value={shutout} onChange={setShutout} />
      </Section>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {DD_TEXT.save}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function CalendarsTab() {
  const { calendars } = useDdCatalogs();
  const canManage = useCan('dd_tariffs:manage');
  const [editing, setEditing] = useState<DdCalendarViewDto | 'new' | null>(null);
  if (editing !== null) return <CalendarEditor existing={editing === 'new' ? null : editing} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />;
  return (
    <section aria-label={DD_TEXT.calendars}>
      {canManage ? (
        <button type="button" className="btn btn-primary mb-3" onClick={() => setEditing('new')}>
          {DD_TEXT.newCalendar}
        </button>
      ) : null}
      {calendars.isError ? (
        <p role="alert">{ddErrorText(calendars.error)}</p>
      ) : !calendars.data ? (
        <div className="skeleton h-24" aria-hidden="true" />
      ) : (
        <table className="data-table text-sm" aria-label={DD_TEXT.calendars}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Closed dates</th>
              <th scope="col">Shutout dates</th>
              <th scope="col">Version</th>
              {canManage ? <th scope="col">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {calendars.data.items.map((c) => (
              <tr key={c.id}>
                <td>
                  <SafeText value={c.data.name} />
                </td>
                <td className="num">{c.data.closedDates.length}</td>
                <td className="num">{c.data.shutoutDates.length}</td>
                <td className="num">{c.version}</td>
                {canManage ? (
                  <td>
                    <button type="button" className="btn" onClick={() => setEditing(c)}>
                      Edit
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
