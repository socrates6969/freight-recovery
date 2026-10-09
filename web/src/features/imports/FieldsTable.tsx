import { confidenceLevel, type ExtractedFieldDto } from '@fr/shared';
import type { ReactNode } from 'react';

import { SafeText } from '../../components/ui/SafeText';

import { confidencePercent, fieldLabel, formatFieldValue, reviewText, sourceText } from './import-format';

/**
 * The "Extracted fields" table (N12). All document-derived strings are text nodes (SafeText); the
 * confidence bar is decorative (aria-hidden). `actions` renders review controls for a field.
 */
export function FieldsTable({ fields, actions }: { fields: readonly ExtractedFieldDto[]; actions?: (f: ExtractedFieldDto) => ReactNode }) {
  return (
    <div className="max-h-[50vh] overflow-auto">
      <table className="data-table text-sm">
        <caption className="mb-2 text-left font-semibold">Extracted fields</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Value</th>
            <th scope="col">Confidence</th>
            <th scope="col">Source</th>
            <th scope="col">Review</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.id}>
              <td className="whitespace-nowrap">{fieldLabel(f.key)}</td>
              <td className="max-w-56">
                <SafeText value={formatFieldValue(f.key, f.kind, f.effectiveValue ?? f.value)} className="num" />
                {f.value === null && f.status === 'PROPOSED' ? <span className="muted"> (unreadable: <SafeText value={f.rawValue} />)</span> : null}
              </td>
              <td className="whitespace-nowrap">
                <span className="num">{confidencePercent(f.confidence)}</span> <span>{confidenceLevel(f.confidence)}</span>
                <meter className="conf-meter" min={0} max={1} value={f.confidence} aria-hidden="true" />
              </td>
              <td className="max-w-64">
                <span className="num">{sourceText(f.source)}</span>
                {f.source ? (
                  <span className="muted break-anywhere block text-xs">
                    <SafeText value={f.source.excerpt} />
                  </span>
                ) : null}
              </td>
              <td>
                {reviewText(f) === 'Needs review' ? <span className="badge badge-warn">Needs review</span> : reviewText(f)}
                {actions ? <div className="mt-1 flex flex-wrap gap-1">{actions(f)}</div> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {fields.length === 0 ? <p className="muted p-3">No fields extracted.</p> : null}
    </div>
  );
}
