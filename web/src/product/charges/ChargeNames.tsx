import { classifyLine } from '@fr/shared/analysis';
import { CATEGORY_LABELS, CHARGE_NOTE, SEED_VERSION, buildChargeClassifier, formatSimilarity } from '@fr/shared/charge-intel';
import { useMemo, useState } from 'react';

import { SafeText, TextArea } from '../ui';

const MAX_NAMES = 200;
const EXAMPLE = 'Detention - Delivery\nTONU\nDriver Assist\nFSC\nLiftgate Service\nLumper fee\nLayover\nStop-off charge\nRedelivery';

export function ChargeNames() {
  const [text, setText] = useState('');
  const classifier = useMemo(() => buildChargeClassifier([]), []);
  const names = useMemo(() => text.split(/\r?\n/u).map((s) => s.trim()).filter((s) => s.length > 0).slice(0, MAX_NAMES), [text]);
  const rows = useMemo(
    () =>
      names.map((name) => ({ name, rule: classifyLine(name), suggestion: classifier.classify(name) })),
    [names, classifier],
  );
  return (
    <div className="flex flex-col gap-4">
      <p className="note">{CHARGE_NOTE}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" onClick={() => setText(EXAMPLE)}>Load examples</button>
        <button type="button" className="btn" onClick={() => setText('')}>Clear</button>
      </div>
      <TextArea label="Charge names from your invoices" value={text} onChange={setText} rows={8} placeholder={EXAMPLE} hint={`One name per line, up to ${MAX_NAMES}. Compared with ${SEED_VERSION}: 175 charge names from six public carrier tariffs.`} />
      {rows.length > 0 ? (
        <div className="scroll">
          <table aria-label="Charge name suggestions">
            <thead>
              <tr><th>Charge name</th><th>Fixed-rule class</th><th>Suggested category</th><th>Similarity</th><th>Nearest public tariff name</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><SafeText value={r.name} /></td>
                  <td>{CATEGORY_LABELS[r.rule]}</td>
                  <td>{r.suggestion.category ? CATEGORY_LABELS[r.suggestion.category] : <span className="muted">No suggestion{r.suggestion.reason === 'below_threshold' ? ' (below threshold)' : ''}</span>}</td>
                  <td className="num">{formatSimilarity(r.suggestion.similarity)}</td>
                  <td className="text-sm">{r.suggestion.nearest ? <><SafeText value={r.suggestion.nearest.text} /> <span className="muted">({r.suggestion.nearest.sourceLabel})</span></> : <span className="muted">none</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="muted text-xs">The fixed-rule class is what the invoice check uses to route a line (detention, linehaul, fuel, accessorial, other). The suggestion is a nearest-example match at the 0.30 threshold; it adds review items and never confirms an amount.</p>
    </div>
  );
}