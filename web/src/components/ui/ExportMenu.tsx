/**
 * Export menu (N12): a button with a menu of "Download CSV" and "Download Excel (.xlsx)". Selecting an
 * item downloads through the API client (Bearer, blob URL, temporary anchor); the item is disabled and
 * `aria-busy` while running. Result texts are fixed: "Export downloaded", "Export failed. Try again.",
 * and for 422 "Too many rows to export. Narrow your filters."
 */
import { Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../../api/client';
import { useApi } from '../../app-context';

export const EXPORT_DONE = 'Export downloaded';
export const EXPORT_FAILED = 'Export failed. Try again.';
export const EXPORT_TOO_LARGE = 'Too many rows to export. Narrow your filters.';

export type ExportFormat = 'csv' | 'xlsx';

export function ExportMenu({ label, pathFor, fallbackName }: { label: string; pathFor: (format: ExportFormat) => string; fallbackName: string }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = async (format: ExportFormat) => {
    setBusy(format);
    setStatus('');
    setError(null);
    try {
      await api.download(pathFor(format), `${fallbackName}.${format}`);
      setStatus(EXPORT_DONE);
      setOpen(false);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 422 ? EXPORT_TOO_LARGE : EXPORT_FAILED);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={ref} className="relative inline-flex flex-col items-end gap-1">
      <button
        type="button"
        className="btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy !== null}
        disabled={busy !== null}
        onClick={() => setOpen((o) => !o)}
      >
        <Download size={16} aria-hidden="true" />
        {label}
      </button>
      {open ? (
        <div role="menu" aria-label={label} className="card absolute top-full right-0 z-20 mt-1 min-w-52 p-1">
          {(
            [
              ['csv', 'Download CSV'],
              ['xlsx', 'Download Excel (.xlsx)'],
            ] as const
          ).map(([format, text]) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-[var(--color-surface-2)]"
              disabled={busy !== null}
              aria-busy={busy === format}
              onClick={() => void run(format)}
            >
              {text}
            </button>
          ))}
        </div>
      ) : null}
      <span role="status" className="muted text-xs">
        {status}
      </span>
      {error ? (
        <span role="alert" className="text-xs text-[var(--color-danger)]">
          {error}
        </span>
      ) : null}
    </div>
  );
}
