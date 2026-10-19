/**
 * Small presentational helpers of the public app. Untrusted text is rendered through SafeText (text nodes
 * only, bidi-isolated); nothing here uses innerHTML or inline styles (CSP: style-src 'self').
 */
import { displayText } from '@fr/shared';
import { useId, type ReactNode } from 'react';

export function SafeText({ value, className }: { value: string | null | undefined; className?: string }) {
  return <bdi className={`safe-text${className ? ` ${className}` : ''}`}>{displayText(value)}</bdi>;
}

function Hint({ id, hint }: { id: string; hint: string | undefined }) {
  if (!hint) return null;
  return (
    <p id={id} className="muted mt-1 text-xs">
      {hint}
    </p>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  hint,
  mono = false,
  required = false,
  inputMode,
  maxLength = 200,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'date' | 'datetime-local' | 'number';
  placeholder?: string;
  hint?: string;
  mono?: boolean;
  required?: boolean;
  inputMode?: 'decimal' | 'numeric' | 'text';
  maxLength?: number;
}) {
  const id = useId();
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input
        id={id}
        className={`input${mono ? ' mono' : ''}`}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      <Hint id={`${id}-hint`} hint={hint} />
    </div>
  );
}

export function Select<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value as T)} aria-describedby={hint ? `${id}-hint` : undefined}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Hint id={`${id}-hint`} hint={hint} />
    </div>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  rows = 6,
  hint,
  placeholder,
  maxLength = 20000,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  hint?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="input mono"
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        spellCheck={false}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      <Hint id={`${id}-hint`} hint={hint} />
    </div>
  );
}

export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
    </div>
  );
}

export function Section({ title, children, intro }: { title: string; children: ReactNode; intro?: string }) {
  return (
    <section className="card flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {intro ? <p className="muted text-sm">{intro}</p> : null}
      {children}
    </section>
  );
}

export function ErrorList({ errors }: { errors: readonly string[] }) {
  if (errors.length === 0) return null;
  return (
    <div role="alert" className="warn">
      <p className="m-0">Please fix the following before running the check:</p>
      <ul className="mt-2 list-disc pl-5 text-sm font-normal">
        {errors.map((e) => (
          <li key={e}>
            <SafeText value={e} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Money text as entered or computed by the engine (already a decimal string). */
export function Money({ value }: { value: string }) {
  return <span className="num">${value}</span>;
}