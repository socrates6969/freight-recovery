/**
 * Tariffs tab (Part B): list, and for users with `dd_tariffs:manage` a tariff editor with the public tariff
 * presets (DD_TEXT.fromPreset, DD_PRESET_NOTE and the preset's provenance). Tiers are edited one per line as
 * `days | SIZE=rate, SIZE=rate` (days empty on the last tier); the body is validated with `DdTariffData`.
 */
import { DD_PRESET_NOTE, DD_TARIFF_PRESETS, DD_TEXT, DdTariffData, DdTariffView, type DdTariffDataDto, type DdTariffPreset, type DdTariffViewDto } from '@fr/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useApi, useCan, useToast } from '../../app-context';
import { SafeText } from '../../components/ui/SafeText';

import { AreaField, CheckField, Section, SelectField, TextField, ddErrorText, useDdCatalogs } from './dd-common';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

interface TariffForm {
  name: string;
  carrier: string;
  chargeType: 'DEMURRAGE' | 'DETENTION';
  direction: 'IMPORT' | 'EXPORT';
  ruleReference: string;
  sourceUrl: string;
  sourceRetrievedOn: string;
  freeDays: string;
  freeDayBasis: 'calendar' | 'working';
  startDayRule: 'included' | 'additional';
  chargeDayBasis: 'calendar' | 'working';
  workingWeekdays: number[];
  tiers: string;
}

const EMPTY: TariffForm = {
  name: '',
  carrier: '',
  chargeType: 'DETENTION',
  direction: 'IMPORT',
  ruleReference: '',
  sourceUrl: '',
  sourceRetrievedOn: '',
  freeDays: '4',
  freeDayBasis: 'working',
  startDayRule: 'included',
  chargeDayBasis: 'calendar',
  workingWeekdays: [1, 2, 3, 4, 5],
  tiers: '',
};

/** `days | SIZE=rate, ...` per tier. */
export function tiersToText(tiers: DdTariffDataDto['tiers']): string {
  return tiers.map((t) => `${t.days ?? ''} | ${Object.entries(t.rates).map(([k, v]) => `${k}=${v}`).join(', ')}`).join('\n');
}

export function textToTiers(text: string): unknown[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((l) => {
      const [daysText = '', ratesText = ''] = l.split('|').map((x) => x.trim());
      const rates: Record<string, string> = {};
      for (const pair of ratesText.split(',')) {
        const [k = '', v = ''] = pair.split('=').map((x) => x.trim());
        if (k !== '') rates[k.toUpperCase()] = v;
      }
      return { days: daysText === '' ? null : /^[0-9]+$/u.test(daysText) ? Number(daysText) : Number.NaN, rates };
    });
}

export function dataToForm(d: DdTariffDataDto): TariffForm {
  return {
    name: d.name,
    carrier: d.carrier,
    chargeType: d.chargeType,
    direction: d.direction,
    ruleReference: d.ruleReference ?? '',
    sourceUrl: d.sourceUrl ?? '',
    sourceRetrievedOn: d.sourceRetrievedOn ?? '',
    freeDays: String(d.freeDays),
    freeDayBasis: d.freeDayBasis,
    startDayRule: d.startDayRule,
    chargeDayBasis: d.chargeDayBasis,
    workingWeekdays: [...d.workingWeekdays],
    tiers: tiersToText(d.tiers),
  };
}

const opt = (v: string): string | null => (v.trim() === '' ? null : v.trim());

export function formToTariff(f: TariffForm) {
  return DdTariffData.safeParse({
    name: f.name,
    carrier: f.carrier,
    chargeType: f.chargeType,
    direction: f.direction,
    ruleReference: opt(f.ruleReference),
    sourceUrl: opt(f.sourceUrl),
    sourceRetrievedOn: opt(f.sourceRetrievedOn),
    freeDays: /^[0-9]{1,2}$/u.test(f.freeDays.trim()) ? Number(f.freeDays.trim()) : Number.NaN,
    freeDayBasis: f.freeDayBasis,
    startDayRule: f.startDayRule,
    chargeDayBasis: f.chargeDayBasis,
    workingWeekdays: f.workingWeekdays,
    tiers: textToTiers(f.tiers),
  });
}

function Provenance({ preset }: { preset: DdTariffPreset }) {
  const p = preset.provenance;
  return (
    <div className="w-full text-sm" aria-label="Preset provenance">
      <p>{DD_PRESET_NOTE}</p>
      <p>
        Carrier: <SafeText value={p.carrier} />. Document: <SafeText value={p.document} />. Retrieved: {p.retrieved}. Verification: {p.verification}.
      </p>
      <ul className="muted">
        {p.assumptions.map((a) => (
          <li key={a}>
            <SafeText value={a} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function TariffEditor({ existing, onDone, onCancel }: { existing: DdTariffViewDto | null; onDone: () => void; onCancel: () => void }) {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState<TariffForm>(() => (existing ? dataToForm(existing.data) : EMPTY));
  const [preset, setPreset] = useState<DdTariffPreset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof TariffForm>(k: K, v: TariffForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: (data: DdTariffDataDto) =>
      existing === null ? api.post('/api/v1/dd/tariffs', data, DdTariffView) : api.put(`/api/v1/dd/tariffs/${encodeURIComponent(existing.id)}`, { version: existing.version, data }, DdTariffView),
    onSuccess: async () => {
      toast('Tariff saved.', 'success');
      await qc.invalidateQueries({ queryKey: ['dd', 'tariffs'] });
      onDone();
    },
    onError: (e) => setError(ddErrorText(e)),
  });
  return (
    <form
      aria-label={existing ? 'Edit tariff' : DD_TEXT.newTariff}
      onSubmit={(e) => {
        e.preventDefault();
        const r = formToTariff(f);
        if (!r.success) {
          setError(`Check these values: ${[...new Set(r.error.issues.map((i) => i.path.map(String).join('.') || 'tariff'))].join(', ')}`);
          return;
        }
        setError(null);
        save.mutate(r.data);
      }}
    >
      {error ? <p role="alert">{error}</p> : null}
      {existing === null ? (
        <Section title={DD_TEXT.fromPreset}>
          <SelectField
            label={DD_TEXT.fromPreset}
            value={preset?.id ?? ''}
            options={[{ value: '', label: 'None' }, ...DD_TARIFF_PRESETS.map((p) => ({ value: p.id, label: p.data.name }))]}
            onChange={(id) => {
              const p = DD_TARIFF_PRESETS.find((x) => x.id === id) ?? null;
              setPreset(p);
              if (p) setF(dataToForm(p.data));
            }}
          />
          {preset ? <Provenance preset={preset} /> : null}
        </Section>
      ) : null}
      <Section title="Tariff">
        <TextField label="Name" value={f.name} onChange={(v) => set('name', v)} />
        <TextField label="Carrier" value={f.carrier} onChange={(v) => set('carrier', v)} />
        <SelectField label="Charge type" value={f.chargeType} options={[{ value: 'DETENTION', label: 'Detention' }, { value: 'DEMURRAGE', label: 'Demurrage' }]} onChange={(v) => set('chargeType', v)} />
        <SelectField label="Direction" value={f.direction} options={[{ value: 'IMPORT', label: 'Import' }, { value: 'EXPORT', label: 'Export' }]} onChange={(v) => set('direction', v)} />
        <TextField label="Rule reference" value={f.ruleReference} onChange={(v) => set('ruleReference', v)} />
        <TextField label="Source URL" value={f.sourceUrl} onChange={(v) => set('sourceUrl', v)} />
        <TextField label="Source retrieved on" value={f.sourceRetrievedOn} onChange={(v) => set('sourceRetrievedOn', v)} />
        <TextField label="Free days" value={f.freeDays} onChange={(v) => set('freeDays', v)} inputMode="numeric" />
        <SelectField label="Free days counted as" value={f.freeDayBasis} options={[{ value: 'working', label: 'Working days' }, { value: 'calendar', label: 'Calendar days' }]} onChange={(v) => set('freeDayBasis', v)} />
        <SelectField label="Start day" value={f.startDayRule} options={[{ value: 'included', label: 'Counts as free day 1' }, { value: 'additional', label: 'Plus the free days' }]} onChange={(v) => set('startDayRule', v)} />
        <SelectField label="Charged days" value={f.chargeDayBasis} options={[{ value: 'calendar', label: 'Calendar days' }, { value: 'working', label: 'Working days' }]} onChange={(v) => set('chargeDayBasis', v)} />
        <fieldset className="flex gap-2">
          <legend className="text-sm">Working days</legend>
          {WEEKDAYS.map((d, i) => (
            <CheckField
              key={d}
              label={d}
              checked={f.workingWeekdays.includes(i + 1)}
              onChange={(on) => set('workingWeekdays', on ? [...f.workingWeekdays, i + 1].sort((a, b) => a - b) : f.workingWeekdays.filter((x) => x !== i + 1))}
            />
          ))}
        </fieldset>
        <AreaField label="Tiers (one per line: days | SIZE=rate, SIZE=rate; days empty on the last tier)" value={f.tiers} onChange={(v) => set('tiers', v)} />
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

export function TariffsTab() {
  const { tariffs } = useDdCatalogs();
  const canManage = useCan('dd_tariffs:manage');
  const [editing, setEditing] = useState<DdTariffViewDto | 'new' | null>(null);
  if (editing !== null) return <TariffEditor existing={editing === 'new' ? null : editing} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />;
  return (
    <section aria-label={DD_TEXT.tariffs}>
      {canManage ? (
        <button type="button" className="btn btn-primary mb-3" onClick={() => setEditing('new')}>
          {DD_TEXT.newTariff}
        </button>
      ) : null}
      {tariffs.isError ? (
        <p role="alert">{ddErrorText(tariffs.error)}</p>
      ) : !tariffs.data ? (
        <div className="skeleton h-24" aria-hidden="true" />
      ) : (
        <table className="data-table text-sm" aria-label={DD_TEXT.tariffs}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Carrier</th>
              <th scope="col">Charge type</th>
              <th scope="col">Direction</th>
              <th scope="col">Version</th>
              {canManage ? <th scope="col">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {tariffs.data.items.map((t) => (
              <tr key={t.id}>
                <td>
                  <SafeText value={t.data.name} />
                </td>
                <td>
                  <SafeText value={t.data.carrier} />
                </td>
                <td>{t.data.chargeType === 'DEMURRAGE' ? 'Demurrage' : 'Detention'}</td>
                <td>{t.data.direction === 'IMPORT' ? 'Import' : 'Export'}</td>
                <td className="num">{t.version}</td>
                {canManage ? (
                  <td>
                    <button type="button" className="btn" onClick={() => setEditing(t)}>
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
